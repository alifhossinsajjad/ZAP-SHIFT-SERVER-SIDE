const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_API_KEY);

const port = process.env.port || 3000;

const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PKG";
  const date = new Date().toISOString().split("T")[0].replace(/-/g, ""); // YYYYMMDD

  // Generate 4 random bytes -> 8 hex characters
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${randomHex}`;
}

// middelware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5t5y07x.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const db = client.db("Zap_ShiftDB");
    const parcelsCollections = db.collection("parcels");
    const paymentCollections = db.collection("payments");
    //parcel api

    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const options = {
        sort: { createdAt: -1 },
      };
      const cursor = parcelsCollections.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    //parcel get api for payment
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      console.log(parcel);
      const createdAt = new Date();
      parcel.createdAt = createdAt;
      const result = await parcelsCollections.insertOne(parcel);
      res.send(result);
    });

    //pacel delete api
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.deleteOne(query);
      res.send(result);
    });

    //payment delated api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: `Parcel Payment for ${paymentInfo.parcelName}`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.senderEmail,
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    //old payment api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: `Parcel Payment for ${paymentInfo.parcelName}`,
              },
              unit_amount: amount,
            },

            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.senderEmail,
        metadata: { parcelId: paymentInfo.parcelId },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });



    
    //payment status update api
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const trackingId = generateTrackingId();

      console.log("session retrieve", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            tracckingId: trackingId,
          },
        };
        const result = await parcelsCollections.updateOne(filter, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          transactionId: session.payment_intent,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          paymentStatus: session.payment_status,
          parcelName: session.metadata.parcelName,
          paidAt: new Date(),
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollections.insertOne(payment);

          res.send({
            success: true,
            modifiedCount: result,
            paymentInfo: resultPayment,
            transactionId: session.payment_intent,
            trackingId: trackingId,
          });
          console.log("payment done", resultPayment);
        }
      }
      res.send({ success: true });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Zap Shifting server running done");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
