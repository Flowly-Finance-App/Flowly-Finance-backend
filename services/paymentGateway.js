let stripeInstance = null;

async function getStripe() {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      // Fallback mock payment intent if Stripe key isn't provided (for testing/local development)
      return {
        isMock: true,
        paymentIntents: {
          create: async ({ amount, currency, metadata }) => ({
            client_secret: `mock_secret_${Date.now()}`,
            id: `pi_mock_${Date.now()}`,
            status: "succeeded",
            amount,
            currency,
            metadata,
          }),
          retrieve: async (id) => ({
            id,
            status: "succeeded",
          }),
        },
        webhooks: {
          constructEvent: (body) => (typeof body === "string" ? JSON.parse(body) : body),
        },
      };
    }

    try {
      const StripeModule = await import("stripe");
      const Stripe = StripeModule.default || StripeModule;
      stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
      console.log("Stripe payment gateway initialized successfully.");
    } catch (err) {
      console.warn("Stripe package initialization failed:", err.message, "Operating in fallback mock mode.");
      stripeInstance = {
        isMock: true,
        paymentIntents: {
          create: async ({ amount, currency, metadata }) => ({
            client_secret: `mock_secret_${Date.now()}`,
            id: `pi_mock_${Date.now()}`,
            status: "succeeded",
            amount,
            currency,
            metadata,
          }),
          retrieve: async (id) => ({ id, status: "succeeded" }),
        },
        webhooks: {
          constructEvent: (body) => (typeof body === "string" ? JSON.parse(body) : body),
        },
      };
    }
  }
  return stripeInstance;
}

export async function createPaymentIntent({ amountInRupees, currency = "inr", metadata = {} }) {
  const stripe = await getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amountInRupees * 100),
    currency,
    metadata,
    payment_method_types: ["card"],
  });

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
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export async function retrievePaymentIntent(transactionId) {
  const stripe = await getStripe();
  return stripe.paymentIntents.retrieve(transactionId);
}

export default { createPaymentIntent, constructWebhookEvent, retrievePaymentIntent };
