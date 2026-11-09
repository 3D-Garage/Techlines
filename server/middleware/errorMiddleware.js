import HttpError from "../services/HttpError.js";

const parserErrors = {
  "entity.parse.failed": [400, "Érvénytelen JSON kérés."],
  "entity.too.large": [413, "A kérés meghaladja a megengedett méretet."],
  "encoding.unsupported": [415, "Unsupported request encoding."],
  "charset.unsupported": [415, "Unsupported request encoding."],
  "request.size.invalid": [400, "Invalid request body."],
  "request.aborted": [400, "Invalid request body."],
};

export const notFound = (_req, res) => res.status(404).json({ message: "Not Found" });

export const errorHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (Object.hasOwn(parserErrors, err.type)) {
    const [status, message] = parserErrors[err.type];
    return res.status(status).json({ message });
  }
  if (err instanceof HttpError) {
    const body = { message: err.message };
    if (err.creationRejected === true) body.creationRejected = true;
    if (err.code === "QUOTE_CHANGED") {
      body.code = "QUOTE_CHANGED";
      body.quote = err.quote;
    }
    if (err.errors) body.errors = err.errors;
    return res.status(err.statusCode).json(body);
  }
  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({ message: "Invalid request data." });
  }
  return res.status(500).json({ message: "Server Error" });
};
