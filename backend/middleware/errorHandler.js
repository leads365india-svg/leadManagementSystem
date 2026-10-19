const errorHandler = (err, req, res, next) => {
  console.error("Error:", err)

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const validationErrors = Object.values(err.errors).map((error) => error.message)
    return res.status(400).json({
      success: false,
      error: validationErrors.join(", "),
    })
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      error: "Duplicate field value entered",
    })
  }

  // Mongoose cast error
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      error: "Invalid ID format",
    })
  }

  // Default error
  res.status(500).json({
    success: false,
    error: "Internal server error",
  })
}

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`,
  })
}

module.exports = {
  errorHandler,
  notFound,
}
