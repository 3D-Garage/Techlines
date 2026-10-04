export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? (err.statusCode || (err.name === "ValidationError" ? 400 : 500)) : res.statusCode;
  res.status(statusCode).json({ message: err.message || "Server Error", ...(err.creationRejected === true ? { creationRejected: true } : {}),
    ...(err.code === "QUOTE_CHANGED" ? { code: "QUOTE_CHANGED", quote: err.quote } : {}) });
};

