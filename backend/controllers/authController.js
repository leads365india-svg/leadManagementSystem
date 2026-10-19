const jwt = require("jsonwebtoken")
const User = require("../models/User")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-superadmin-secret-key-2026-secure"
const JWT_EXPIRES_IN = "24h"

const login = async (req, res) => {
  try {
    const { email, password } = req.body

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    const invalidCredentialsResponse = () => {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password")
    if (!user) {
      return invalidCredentialsResponse()
    }

    // Check if user is suspended
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        error: "Account has been suspended. Please contact support.",
      })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return invalidCredentialsResponse()
    }

    // Sign JWT
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    )

    // Set secure HTTP-only cookie
    const isProduction = process.env.NODE_ENV === "production"
    res.cookie("superadmin_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    })

    const authUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      status: user.status,
    }

    res.status(200).json({
      success: true,
      data: {
        user: authUser,
      },
      message: "Authentication successful",
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({
      success: false,
      error: "Authentication failed. Please try again later.",
    })
  }
}

const logout = async (_req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === "production"
    res.clearCookie("superadmin_token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    })

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error during logout",
    })
  }
}

const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      })
    }

    res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch user profile",
    })
  }
}

module.exports = {
  login,
  logout,
  getMe,
}
