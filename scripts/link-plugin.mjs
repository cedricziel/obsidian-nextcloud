import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { symlink } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PLUGIN_NAME = 'obsidian-nextcloud-plugin';
const CONFIG_PATH = join(__dirname, 'dev-config.json');

// Mac default vault path
const DEFAULT_VAULT_PATH = join(homedir(), 'Documents', 'Obsidian Vault');

// Prompt for user input
const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Load or create config
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

// Save config
function saveConfig(config) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

async function linkPlugin() {
  try {
    console.log('Linking plugin to Obsidian...');

    // Get plugin source directory (where we're developing)
    const pluginDir = resolve(join(__dirname, '..'));
    console.log(`Plugin source directory: ${pluginDir}`);

    // Load config
    const config = loadConfig();
    let vaultPath = config.vaultPath;

    // If no vault path in config, ask user and save it
    if (!vaultPath) {
      vaultPath = await new Promise((resolve) => {
        readline.question(`Enter your Obsidian vault path [${DEFAULT_VAULT_PATH}]: `, (input) => {
          resolve(input || DEFAULT_VAULT_PATH);
        });
      });

      // Save the vault path for future use
      config.vaultPath = vaultPath;
      saveConfig(config);
      console.log(`Vault path saved to config: ${vaultPath}`);
    } else {
      console.log(`Using vault path from config: ${vaultPath}`);
    }

    // Build the plugins directory path
    const pluginsDir = join(vaultPath, '.obsidian', 'plugins');
    const targetPluginDir = join(pluginsDir, PLUGIN_NAME);

    console.log(`Ensuring Obsidian plugins directory exists: ${pluginsDir}`);

    // Create the plugins directory if it doesn't exist
    if (!existsSync(pluginsDir)) {
      mkdirSync(pluginsDir, { recursive: true });
      console.log('Created plugins directory.');
    }

    // Check if plugin directory already exists
    if (existsSync(targetPluginDir)) {
      console.log(`Plugin is already linked at: ${targetPluginDir}`);
      readline.close();
      return;
    }

    // Create symbolic link
    try {
      await symlink(pluginDir, targetPluginDir, 'junction');
      console.log(`Successfully linked plugin to: ${targetPluginDir}`);
    } catch (err) {
      // If permission denied, suggest using sudo on non-macOS platforms
      if (err.code === 'EPERM') {
        console.error('Permission denied. Try running with administrator privileges.');
      } else {
        console.error(`Error creating symbolic link: ${err.message}`);
      }
    }

    readline.close();
  } catch (error) {
    console.error('Error linking plugin:', error);
    readline.close();
    process.exit(1);
  }
}

linkPlugin();
