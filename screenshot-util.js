// Utilitaire pour capturer un screenshot sur un écran spécifique (par défaut écran 0)
const screenshot = require('screenshot-desktop');

// Fonction principale pour capturer un screenshot
module.exports = async function({ filename, screenId } = {}) {
  // screenIndex: index de l'écran à capturer (0 par défaut)
  // screenId: identifiant réel de l'écran (optionnel)
  const options = { filename }; 
    options.screen = screenId; 
  return screenshot(options);
};

// Fonction utilitaire pour lister les écrans disponibles
module.exports.listScreens = async function() {
  const displays = await screenshot.listDisplays();
  // Affiche les infos utiles pour chaque écran
  displays.forEach((display, idx) => {
    console.log(`Écran ${idx}: id=${display.id}, name=${display.name || ''}, bounds=${JSON.stringify(display.bounds)}`);
  });
  return displays;
};
