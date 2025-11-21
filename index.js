const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.port || 3000;

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
      const query = {_id : new ObjectId(id)};
      const result = await parcelsCollections.deleteOne(query);
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
