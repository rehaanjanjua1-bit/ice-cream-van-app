import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(buf.toString());
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.created') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.user_id;
    const customerId = session.customer;
    if (userId) {
      const update = { subscribed: true };
      if (customerId) update.stripe_customer_id = customerId;
      await sb.from('profiles').update(update).eq('id', userId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    if (customerId) {
      await sb.from('profiles').update({ subscribed: false }).eq('stripe_customer_id', customerId);
    }
  }

  res.status(200).json({ received: true });
}
