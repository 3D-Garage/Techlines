// CRACO config: dev-server tweaks for local development
// client/craco.config.js
module.exports = {
  devServer: (devServerConfig) => {
    // Explicit módon beállítjuk, így nem számít, mi jön az env-ből
    devServerConfig.allowedHosts = "all"; // vagy: ['localhost', '127.0.0.1']
    // (opcionális) ha szükséges:
    // devServerConfig.host = 'localhost';
    // devServerConfig.port = 3000;
    // Return the mutated devServer config
    return devServerConfig;
  },
};
