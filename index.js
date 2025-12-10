const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require("stripe");
const admin = require("firebase-admin");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());


const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decodedKey);


admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})


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
        const usersCollection = db.collection('users');
        const ridersCollection = db.collection('riders'); // ✅ defined here
        const trackingCollection = db.collection('trackings'); // (if you plan to use it later)


        // custom middlewares
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(401).send({ message: "forbidden access 1" })
            }
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access 2' })
            }
            next();
        }

        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'forbidden access 2' })
            }
            next();
        }

        app.get("/users/search", async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });

        // DEMO USERS CREATOR
        app.get("/create-demo-users", async (req, res) => {
            try {
                const demoUsers = [
                    {
                        name: "Demo Admin",
                        email: "demo_adminn@gmail.com",
                        role: "admin",
                        createdAt: new Date()
                    },
                    {
                        name: "Demo User",
                        email: "demoo_user@gmail.com",
                        role: "user",
                        createdAt: new Date()
                    },
                    {
                        name: "Demo Rider",
                        email: "demo_rider@gmail.com",
                        role: "rider",
                        createdAt: new Date()
                    }
                ];

                const results = [];

                for (const user of demoUsers) {
                    const exists = await usersCollection.findOne({ email: user.email });

                    if (!exists) {
                        const inserted = await usersCollection.insertOne(user);
                        results.push({ email: user.email, created: true });
                    } else {
                        results.push({ email: user.email, created: false, message: "Already exists" });
                    }
                }

                res.send({
                    success: true,
                    message: "Demo users created successfully",
                    results
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: "Error creating demo users" });
            }
        });

        app.post('/auth/save-user', async (req, res) => {
            try {
                const { email, name, role } = req.body;

                const existing = await usersCollection.findOne({ email });

                if (!existing) {
                    await usersCollection.insertOne({
                        email,
                        name,
                        role: role || "user",
                        createdAt: new Date()
                    });
                }

                res.send({ success: true });
            } catch {
                res.status(500).send({ success: false });
            }
        });



        // GET: Get user role by email
        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        app.get("/users", async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });


        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                // update last log in
                return res.status(200).send({ message: 'User already exists', inserted: false });
            }
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        // app.patch("/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {
        //     const { id } = req.params;
        //     const { role } = req.body;

        //     if (!["admin", "user"].includes(role)) {
        //         return res.status(400).send({ message: "Invalid role" });
        //     }

        //     try {
        //         const result = await usersCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             { $set: { role } }
        //         );
        //         res.send({ message: `User role updated to ${role}`, result });
        //     } catch (error) {
        //         console.error("Error updating user role", error);
        //         res.status(500).send({ message: "Failed to update user role" });
        //     }
        // });

        app.patch("/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send({ message: `User role updated to ${role}`, result });
        });


        // app.get('/parcels', verifyFBToken, async (req, res) => {
        //     const parcels = await parcelCollection.find().toArray();
        //     res.send(parcels);
        // });



        // parcels route...........................................
        // GET: All parcels OR parcels by user (created_by), sorted by latest
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let query = {}
                if (email) {
                    query = { created_by: email }
                }

                if (payment_status) {
                    query.payment_status = payment_status
                }

                if (delivery_status) {
                    query.delivery_status = delivery_status
                }

                const options = {
                    sort: { createdAt: -1 }, // Newest first
                };

                console.log('parcel query', req.query, query)

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
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

        app.patch("/parcels/update-status/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { delivery_status } = req.body;

                const updated = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { delivery_status } }
                );

                res.json({ success: true, updated });
            } catch (err) {
                res.json({ success: false, message: "Failed to update status" });
            }
        });


        app.patch("/parcels/:id/status", async (req, res) => {
            try {
                const id = req.params.id;
                const { status } = req.body;
                const updatedDoc = {
                    delivery_status: status
                }
                if (status === 'in_transit') {
                    updatedDoc.picked_at = new Date().toISOString()
                }

                else if (status === 'delivered') {
                    updatedDoc.delivered_at = new Date().toISOString()
                }

                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedDoc }
                );

                res.send({ success: true, result });

            } catch (error) {
                console.error(error);
                return res.status(400).json({
                    success: false,
                    message: "Invalid parcel ID"
                });
            }
        });

        // app.patch("/parcels/:id/status", async (req, res) => {
        //     try {
        //         const id = req.params.id;

        //         const result = await parcelCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             { $set: req.body }
        //         );

        //         res.send({ success: true, result });

        //     } catch (error) {
        //         console.error(error);
        //         return res.status(400).json({
        //             success: false,
        //             message: "Invalid parcel ID"
        //         });
        //     }
        // });


        // Update rider

        // app.patch("/parcels/:id/assign", async (req, res) => {
        //     const parcelId = req.params.id;
        //     const { riderId, riderName, riderEmail } = req.body;

        //     try {
        //         // Update parcel
        //         await parcelCollection.updateOne(
        //             { _id: new ObjectId(parcelId) },
        //             {
        //                 $set: {
        //                     delivery_status: "rider_assigned",
        //                     assigned_rider_id: riderId,
        //                     assigned_rider_email: riderEmail,
        //                     assigned_rider_name: riderName,
        //                 },
        //             }
        //         );

        //         await ridersCollection.updateOne(
        //             { _id: new ObjectId(riderId) },
        //             {
        //                 $set: {
        //                     work_status: "in_delivery",
        //                 },
        //             }
        //         );

        //         res.send({ message: "Rider assigned" });
        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).send({ message: "Failed to assign rider" });
        //     }
        // });


        app.patch("/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName, riderEmail } = req.body;

            try {
                // 1️⃣ Update parcel with rider assignment
                await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "rider_assigned",
                            assigned_rider_id: riderId,
                            assigned_rider_email: riderEmail,
                            assigned_rider_name: riderName,
                        },
                    }
                );

                // 2️⃣ Update rider work status
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    { $set: { work_status: "in_delivery" } }
                );

                // 3️⃣ Get parcel info so we can use its tracking_id
                const parcel = await parcelCollection.findOne({
                    _id: new ObjectId(parcelId),
                });

                // 4️⃣ Insert tracking log automatically
                await trackingCollection.insertOne({
                    parcel_id: parcelId,
                    tracking_id: parcel.tracking_id,
                    status: "rider_assigned",
                    message: `Rider ${riderName} has been assigned to deliver the parcel.`,
                    updated_by: "system", // or admin email
                    timestamp: new Date(),
                });

                res.send({ message: "Rider assigned & tracking updated" });

            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
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

        // parcels Api
        // GET: All parcels OR parcels by user (created_by), sorted by latest
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let query = {}
                if (email) {
                    query = { created_by: email }
                }

                if (payment_status) {
                    query.payment_status = payment_status
                }

                if (delivery_status) {
                    query.delivery_status = delivery_status
                }

                const options = {
                    sort: { createdAt: -1 }, // Newest first
                };

                console.log('parcel query', req.query, query)

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
        });


        // payment route....................................

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
                const email = req.query.email;
                console.log('decoded', req.decoded)

                const query = email ? { email: email } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
            }
        });

        // Get payments for a specific user/rider
        app.get("/payments/user", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                const payments = await paymentsCollection
                    .find({ email: email })
                    .sort({ paid_at: -1 }) // latest first
                    .toArray();

                // Optionally add parcel info
                for (let p of payments) {
                    if (p.parcelId) {
                        const parcel = await parcelCollection.findOne({ _id: new ObjectId(p.parcelId) });
                        if (parcel) {
                            p.tracking_id = parcel.tracking_id;
                            p.title = parcel.title;
                            p.delivery_status = parcel.delivery_status;
                            p.amount = parcel.totalCost || p.amount;
                            p.date = parcel.createdAt;
                        }
                    }
                }

                res.send({ success: true, data: payments });

            } catch (error) {
                console.error("Error fetching user payments:", error);
                res.status(500).send({ success: false, message: "Failed to fetch user payments" });
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

        // riders section ....................................
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollection.insertOne(rider);
            res.send(result);
        })
        app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await ridersCollection.find({ status: "active" }).toArray();
            res.send(result);
        });


        app.get("/riders/pending", verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection
                    .find({ status: "pending" })
                    .toArray();

                res.send(pendingRiders);
            } catch (error) {
                console.error("Failed to load pending riders:", error);
                res.status(500).send({ message: "Failed to load pending riders" });
            }
        });

        // app.get("/riders/available", async (req, res) => {
        //     const { district } = req.query;

        //     try {
        //         const riders = await ridersCollection
        //             .find({
        //                 district,
        //                 // status: { $in: ["approved", "active"] },
        //                 // work_status: "available",
        //             })
        //             .toArray();

        //         res.send(riders);
        //     } catch (err) {
        //         res.status(500).send({ message: "Failed to load riders" });
        //     }
        // });


        app.get("/riders/available", async (req, res) => {
            const { district } = req.query;

            console.log('ghorar dim', district)

            if (!district) {
                return res.status(400).send({ message: "District is required" });
            }

            try {
                const riders = await ridersCollection
                    .find({
                        // Case-insensitive district match
                        district: { $regex: new RegExp(district, "i") },

                        // Only active & available riders
                        status: { $in: ["active", "approved"] },
                        work_status: { $in: ["available", null] },
                    })
                    .toArray();

                res.send(riders);
            } catch (err) {
                console.error("Failed to load riders:", err);
                res.status(500).send({ message: "Failed to load riders" });
            }
        });


        app.patch("/riders/:id/status", async (req, res) => {
            const { id } = req.params;
            const { status, email } = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set:
                {
                    status
                }
            }

            try {
                const result = await ridersCollection.updateOne(
                    query, updateDoc

                );

                // update user role for accepting rider
                if (status === 'active') {
                    const userQuery = { email };
                    const userUpdateDoc = {
                        $set: {
                            role: 'rider'
                        }
                    };
                    const roleResult = await usersCollection.updateOne(userQuery, userUpdateDoc)
                    console.log(roleResult.modifiedCount)
                }

                res.send(result);
            } catch (err) {
                res.status(500).send({ message: "Failed to update rider status" });
            }
        });



        // tracking route ..............................
        app.post("/trackings", async (req, res) => {
            const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

            const log = {
                tracking_id,
                parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                status,
                message,
                time: new Date(),
                updated_by,
            };

            const result = await trackingCollection.insertOne(log);
            res.send({ success: true, insertedId: result.insertedId });
        });


        app.get('/trackings/:trackingId/logs', async (req, res) => {
            try {
                const trackingId = req.params.trackingId;
                const logs = await trackingCollection
                    .find({ tracking_id: trackingId }) // correct field name
                    .sort({ time: 1 }) // optional: sort by time
                    .toArray();

                res.send(logs);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to fetch tracking logs" });
            }
        });





        // rider..............................

        app.get("/rider/parcels", async (req, res) => {
            const riderEmail = req.query.email;

            if (!riderEmail) {
                return res.status(400).json({ message: "Rider email is required" });
            }

            const pendingDeliveries = await parcelCollection.find({
                assigned_rider_email: riderEmail,
                delivery_status: { $in: ["rider_assigned", "in_transit"] }
            }).toArray();

            res.status(200).json({
                success: true,
                count: pendingDeliveries.length,
                data: pendingDeliveries
            });
        });


        // GET: Completed deliveries for a rider
        // app.get("/rider/completed-deliveries", verifyFBToken, verifyRider, async (req, res) => {
        //     const riderEmail = req.query.email;

        //     if (!riderEmail) {
        //         return res.status(400).json({ message: "Rider email is required" });
        //     }

        //     try {
        //         const completedDeliveries = await parcelCollection.find({
        //             assigned_rider_email: riderEmail,
        //             delivery_status: { $in: ["delivered", "service_center_delivered"] }
        //         }).toArray();

        //         res.status(200).json({
        //             success: true,
        //             count: completedDeliveries.length,
        //             data: completedDeliveries
        //         });
        //     } catch (error) {
        //         console.error("Error fetching completed deliveries:", error);
        //         res.status(500).json({
        //             success: false,
        //             message: "Failed to fetch completed deliveries"
        //         });
        //     }
        // });
        // GET: Completed deliveries for a rider
        app.get("/rider/completed-deliveries", verifyFBToken, verifyRider, async (req, res) => {
            const riderEmail = req.query.email;

            if (!riderEmail) {
                return res.status(400).json({ message: "Rider email is required" });
            }

            try {
                const completedDeliveries = await parcelCollection.find({
                    assigned_rider_email: riderEmail,
                    delivery_status: { $in: ["delivered", "service_center_delivered"] }
                }).toArray();

                res.status(200).json({
                    success: true,
                    count: completedDeliveries.length,
                    data: completedDeliveries
                });
            } catch (error) {
                console.error("Error fetching completed deliveries:", error);
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch completed deliveries"
                });
            }
        });

        // PATCH: Cashout a completed delivery
        app.patch("/rider/completed-deliveries/:id/cashout", verifyFBToken, verifyRider, async (req, res) => {
            const deliveryId = req.params.id;
            const riderEmail = req.decoded.email; // rider's email from token

            if (!deliveryId) {
                return res.status(400).json({ message: "Delivery ID is required" });
            }

            try {
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(deliveryId) });

                if (!parcel) return res.status(404).json({ message: "Delivery not found" });
                if (parcel.assigned_rider_email !== riderEmail) return res.status(403).json({ message: "Unauthorized" });
                if (!["delivered", "service_center_delivered"].includes(parcel.delivery_status)) {
                    return res.status(400).json({ message: "Delivery is not completed yet" });
                }
                if (parcel.payout_cashed) return res.status(400).json({ message: "Already cashed out" });

                const totalCost = parcel.totalCost || 0;
                const districtMatch = (parcel.sender_district?.toLowerCase() === parcel.receiver_district?.toLowerCase());
                const payout = districtMatch ? totalCost * 0.8 : totalCost * 0.3;

                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(deliveryId) },
                    { $set: { payout_cashed: true, payout_amount: parseFloat(payout.toFixed(2)) } }
                );

                res.status(200).json({
                    success: true,
                    message: "Delivery cashed out successfully",
                    payout: parseFloat(payout.toFixed(2)),
                });

            } catch (error) {
                console.error("Error cashing out delivery:", error);
                res.status(500).json({ success: false, message: "Failed to cash out delivery" });
            }
        });


        app.patch("/rider/update-status/:id", verifyFBToken, verifyRider, async (req, res) => {
            const id = req.params.id;
            const { delivery_status } = req.body;

            const updateDoc = {
                $set: {
                    delivery_status: delivery_status,
                }
            };

            // When delivered → store timestamp
            if (delivery_status === "delivered" || delivery_status === "service_center_delivered") {
                updateDoc.$set.deliveredAt = new Date();
            }

            try {
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                res.send({
                    success: true,
                    message: "Status updated",
                    result
                });

            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Failed to update"
                });
            }
        });



        // app.post('/parcels', async (req, res) => {
        //     try {
        //         const newParcel = req.body;
        //         // console.log('Received new parcel:', newParcel);
        //         const result = await parcelCollection.insertOne(newParcel);
        //         res.status(201).send(result);
        //     } catch (error) {
        //         console.error('Error adding parcel:', error);
        //         res.status(500).send({ message: 'Failed to add parcel', error });
        //     }
        // });

        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = {
                    ...req.body,
                    createdAt: new Date()   // <<< THIS IS IMPORTANT
                };

                const result = await parcelCollection.insertOne(newParcel);
                res.status(201).send(result);
            } catch (error) {
                console.error('Error adding parcel:', error);
                res.status(500).send({ message: 'Failed to add parcel', error });
            }
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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


