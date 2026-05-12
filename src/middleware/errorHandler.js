const errorHandler = (err, req, res, next) => {
  console.error("[Error]", err.stack || err.message);
  const status  = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  return res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
