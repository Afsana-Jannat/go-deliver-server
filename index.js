const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require('mongodb');


dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nbzul73.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('parcelDB')
        const parcelCollection = db.collection('parcels')


        app.get('/parcels', async (req, res) => {
            const parcels = await parcelCollection.find().toArray();
            res.send(parcels);
        });

        // parcels Api
        app.get("/parcels", async (req, res) => {
            try {
                const { email } = req.query;

                let query = {};
                if (email) {
                    query.created_by = email;
                }

                // Find parcels (filtered if email given), sorted by newest first
                const parcels = await parcelCollection.find(query).sort({ createdAt: -1 });

                if (!parcels || parcels.length === 0) {
                    return res.status(404).json({
                        message: email
                            ? `No parcels found for ${email}.`
                            : "No parcels found.",
                    });
                }

                res.status(200).json(parcels);
            } catch (error) {
                console.error("❌ Error fetching parcels:", error);
                res.status(500).json({ message: "Server error while fetching parcels." });
            }
        });


        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;
                // console.log('Received new parcel:', newParcel);
                const result = await parcelCollection.insertOne(newParcel);
                res.status(201).send(result);
            } catch (error) {
                console.error('Error adding parcel:', error);
                res.status(500).send({ message: 'Failed to add parcel', error });
            }
        });


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// Root route
app.get("/", (req, res) => {
    res.send("Parcel server is running 🚚");
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});