const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require("stripe");


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

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('parcelDB')
        const parcelCollection = db.collection('parcels');
        const paymentsCollection = db.collection('payments')


        app.get('/parcels', async (req, res) => {
            const parcels = await parcelCollection.find().toArray();
            res.send(parcels);
        });

        // GET: Get a specific parcel by ID
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

                if (!parcel) {
                    return res.status(404).send({ message: 'Parcel not found' });
                }

                res.send(parcel);
            } catch (error) {
                console.error('Error fetching parcel:', error);
                res.status(500).send({ message: 'Failed to fetch parcel' });
            }
        });



        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });




        app.get('/payments', async (req, res) => {
            try {
                const userEmail = req.query.email;

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
            }
        });

        // POST: Record payment and update parcel status
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

                // 1. Update parcel's payment_status
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'Parcel not found or already paid' });
                }

                // 2. Insert payment record
                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date(),
                };

                const paymentResult = await paymentsCollection.insertOne(paymentDoc);

                res.status(201).send({
                    message: 'Payment recorded and parcel marked as paid',
                    insertedId: paymentResult.insertedId,
                });

            } catch (error) {
                console.error('Payment processing failed:', error);
                res.status(500).send({ message: 'Failed to record payment' });
            }
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

        // Delete a parcel by ID

        app.delete("/parcels/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) }; // ✅ convert string to ObjectId
                const result = await parcelCollection.deleteOne(query);

                if (result.deletedCount > 0) {
                    res.status(200).json({ deletedCount: result.deletedCount, message: "Parcel deleted successfully" });
                } else {
                    res.status(404).json({ message: "Parcel not found" });
                }
            } catch (error) {
                console.error("❌ Error deleting parcel:", error);
                res.status(500).json({ message: "Server error while deleting parcel" });
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


