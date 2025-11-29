const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_API_KEY);

const port = process.env.port || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./zapShiftAuthentication.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PKG";
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${randomHex}`;
}

// middelware
app.use(express.json());
app.use(cors());

//verify jwt

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log("decoded token", decodedToken);
    req.decoded_email = decodedToken.email;
  } catch (error) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  next();
};

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
    const userCollections = db.collection("users");
    const parcelsCollections = db.collection("parcels");
    const paymentCollections = db.collection("payments");
    const riderCollections = db.collection("riders");

    //user api

    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollections.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const query = { email: user?.email };

      const existingUser = await userCollections.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }

      const result = await userCollections.insertOne(user);
      res.send(result);
    });

    //manage user api

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await userCollections.updateOne(query, updateDoc);

      res.send(result);
    });

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

    //parcel post api
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      // console.log(parcel);
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

    //payment post api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log("it is my payment info", paymentInfo);
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
      // console.log(session);
      res.send({ url: session.url });
    });

    //old payment api

    // app.post("/create-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100;
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "USD",
    //           product_data: {
    //             name: `Parcel Payment for ${paymentInfo.parcelName}`,
    //           },
    //           unit_amount: amount,
    //         },

    //         quantity: 1,
    //       },
    //     ],
    //     mode: "payment",
    //     customer_email: paymentInfo.senderEmail,
    //     metadata: { parcelId: paymentInfo.parcelId },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancled`,
    //   });
    //   // console.log(session);
    //   res.send({ url: session.url });
    // });

    //payment status update api
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const existingPayment = await paymentCollections.findOne(query);
      if (existingPayment) {
        return res.send({
          success: true,
          message: "Payment already done.",
          transactionId,
          trackingId: existingPayment.trackingId,
        });
      }

      const trackingId = generateTrackingId();

      console.log("session retrieve", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await parcelsCollections.updateOne(filter, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          name: session.metadata.senderName,
          transactionId: session.payment_intent,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          paymentStatus: session.payment_status,
          parcelName: session.metadata.parcelName,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollections.insertOne(payment);

          return res.send({
            success: true,
            modifiedCount: result,
            paymentInfo: resultPayment,
            transactionId: session.payment_intent,
            trackingId: trackingId,
            customerEmail: session.customer_email,
          });
          // console.log("payment done", resultPayment);
        }
      }
      res.send({ success: true });
    });

    // paymment history get api
    app.get("/payments", verifyFBToken, async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.customerEmail = email;

        //checking email and decoded email
        if (email !== req.decoded_email) {
          return res
            .status(403)
            .send({ error: 1, message: "forbidden access" });
        }
      }

      const options = {
        sort: { paidAt: -1 },
      };
      const cursor = paymentCollections.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    //rider post api
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();

      const result = await riderCollections.insertOne(rider);
      res.send(result);
    });

    //rider role base get api

    app.get("/riders", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = riderCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //rider patch api

    app.patch("/riders/:id", verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          status: status,
        },
      };

      const result = await riderCollections.updateOne(query, updateDoc);
      if (status == "approved") {
        const email = req.body.email;
        const userQuery = { email };

        const updateUser = {
          $set: {
            role: "rider",
          },
        };

        const userResult = await userCollections.updateOne(
          userQuery,
          updateUser
        );
      }
      res.send(result);
    });

    //rider delete api
    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await riderCollections.deleteOne(query);
      res.send(result);
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
