function formatErrorMessage(errorMessage) {
  return errorMessage
    .replace(/["\\]/g, "") // Strip double quotes and backslashes
    .replace(/^\w/, (c) => c.toUpperCase()); // Uppercase the first letter
}

module.exports = {
  formatErrorMessage,
}
