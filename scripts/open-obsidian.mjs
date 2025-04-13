import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CONFIG_PATH = join(__dirname, 'dev-config.json');

// Mac default vault path
const DEFAULT_VAULT_PATH = join(homedir(), 'Documents', 'Obsidian Vault');

// Prompt for user input
const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Load config
function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const configData = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      return configData;
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }

  return { vaultPath: '' };
}

async function openObsidian() {
  try {
    console.log('Opening Obsidian with plugin enabled...');

    // Load config to get vault path
    const config = loadConfig();
    const vaultPath = config.vaultPath || DEFAULT_VAULT_PATH;

    if (!config.vaultPath) {
      console.log('No vault path found in config. Run "npm run link-plugin" first to set up your vault path.');
    } else {
      console.log(`Using vault path from config: ${vaultPath}`);
    }

    // Use obsidian:// URL protocol to open the vault
    const obsidianUrl = `obsidian://open?path=${encodeURIComponent(vaultPath)}`;

    // Open Obsidian with the specified vault
    exec(`open "${obsidianUrl}"`, (error) => {
      if (error) {
        console.error('Error opening Obsidian:', error);
      } else {
        console.log('Obsidian opened successfully!');
        console.log('Remember to enable the plugin in Obsidian settings if this is your first time.');
      }
      readline.close();
    });
  } catch (error) {
    console.error('Error opening Obsidian:', error);
    readline.close();
    process.exit(1);
  }
}

openObsidian();
