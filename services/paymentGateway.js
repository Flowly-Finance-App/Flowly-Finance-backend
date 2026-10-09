let stripeInstance = null;

const isProduction = () => process.env.NODE_ENV === "production";

// Local-development stand-in for Stripe. Never used in production.
// Keeps created intents in memory so retrieve() returns the same amount/currency/metadata.
function createMockStripe() {
  const intents = new Map();
  return {
    isMock: true,
    paymentIntents: {
      create: async ({ amount, currency, metadata }) => {
        const id = `pi_mock_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const intent = {
          client_secret: `${id}_secret_mock`,
          id,
          status: "succeeded",
          amount,
          amount_received: amount,
          currency,
          metadata,
        };
        intents.set(id, intent);
        return intent;
      },
      retrieve: async (id) => intents.get(id) || { id, status: "succeeded" },
    },
    webhooks: {
      constructEvent: (body) => (typeof body === "string" ? JSON.parse(body) : body),
    },
  };
}

async function getStripe() {
  if (stripeInstance) return stripeInstance;

  if (!process.env.STRIPE_SECRET_KEY) {
    if (isProduction()) {
      throw new Error("STRIPE_SECRET_KEY is not set. Refusing to use the mock payment gateway in production.");
    }
    console.warn("STRIPE_SECRET_KEY not set. Using mock payment gateway (development only).");
    return createMockStripe(); // not cached, so adding the key later takes effect
  }

  try {
    const StripeModule = await import("stripe");
    const Stripe = StripeModule.default || StripeModule;
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log("Stripe payment gateway initialized successfully.");
    return stripeInstance;
  } catch (err) {
    if (isProduction()) {
      // Fail loudly: a broken gateway must never look like a successful payment.
      throw new Error(`Stripe initialization failed in production: ${err.message}`);
    }
    console.warn("Stripe package initialization failed:", err.message, "Operating in mock mode (development only).");
    return createMockStripe();
  }
}

export async function createPaymentIntent({
  amountInRupees,
  currency = "inr",
  metadata = {},
  description,
  idempotencyKey,
}) {
  const stripe = await getStripe();
  const params = {
    amount: Math.round(amountInRupees * 100),
    currency,
    metadata,
    payment_method_types: ["card"],
  };
  if (description) params.description = description;

  const intent = await stripe.paymentIntents.create(
    params,
    idempotencyKey ? { idempotencyKey } : undefined
  );

  return {
    clientSecret: intent.client_secret,
    transactionId: intent.id,
    status: intent.status,
  };
}

export async function constructWebhookEvent(rawBody, signature) {
  const stripe = await getStripe();
  if (stripe.isMock) {
    return typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set; cannot verify webhook signature.");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// `options.expand` lets callers pull nested objects, e.g. { expand: ["latest_charge"] }
// to read the card brand / last4 for the receipt.
export async function retrievePaymentIntent(transactionId, options = {}) {
  const stripe = await getStripe();
  return stripe.paymentIntents.retrieve(transactionId, options.expand ? { expand: options.expand } : undefined);
}

export default { createPaymentIntent, constructWebhookEvent, retrievePaymentIntent };