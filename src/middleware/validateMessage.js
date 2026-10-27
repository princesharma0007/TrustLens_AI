const Joi = require('joi');

// Validation schema for the incoming analysis request
const schema = Joi.object({
  message: Joi.string().trim().min(1).max(2000).required()
});

module.exports = (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    // Respond with 400 and a structured error payload
    return res.status(400).json({
      success: false,
      error: 'Invalid request payload',
      details: error.details.map(d => d.message)
    });
  }
  next();
};
