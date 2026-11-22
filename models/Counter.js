// models/Counter.js
// Atomic sequences (order numbers). countDocuments() + 1 races: two orders in
// the same second get the same number and one fails on the unique index.
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });

const Counter = mongoose.model("Counter", counterSchema);

export const nextSeq = async (key) => {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
            return doc.seq;
        } catch (err) {
            // Two first-of-the-day upserts can collide on insert; the retry
            // finds the document the other one created.
            if (err.code !== 11000 || attempt) throw err;
        }
    }
    throw new Error("unreachable");
};

export default Counter;
