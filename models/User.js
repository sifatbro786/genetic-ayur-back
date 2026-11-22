// models/User.js
// Dashboard accounts only. Shoppers never sign up: the landing page takes
// guest orders. There is no public register route; accounts are created with
// `npm run admin:create`.
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true, maxlength: 80, default: "" },
        email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160, unique: true },
        // select:false so no query can echo a hash back in a response by accident.
        password: { type: String, required: true, minlength: 10, select: false },
        role: { type: String, enum: ["admin"], default: "admin" },
        isActive: { type: Boolean, default: true },
        // Bumped on password change. Tokens carry the version they were issued
        // with, so a password reset logs out every other session at once
        // instead of leaving old tokens valid until JWT_EXPIRE.
        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date },
    },
    { timestamps: true },
);

userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 12);
    if (!this.isNew) this.tokenVersion += 1;
});

userSchema.methods.matchPassword = function (plain) {
    return bcrypt.compare(String(plain), this.password);
};

userSchema.set("toJSON", {
    transform: (_doc, ret) => {
        delete ret.password;
        delete ret.tokenVersion;
        delete ret.__v;
        return ret;
    },
});

export default mongoose.model("User", userSchema);
