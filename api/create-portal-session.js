import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile, error } = await sb
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user_id)
    .single();

  if (error || !profile?.stripe_customer_id) {
    return res.status(404).json({ error: 'No Stripe customer found for this account yet.' });
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: req.headers.origin || process.env.APP_URL,
    });
    res.status(200).json({ url: portalSession.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
