import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { createClient, WebDAVClient } from 'webdav';

interface NextcloudPluginSettings {
	nextcloudUrl: string;
	username: string;
	password: string;
	collectivePath: string;
	syncInterval: number;
	syncOnStartup: boolean;
	syncOnSave: boolean;
	localFolderPath: string;
}

interface RemoteFile {
	filename: string;
	basename: string;
	type: 'directory' | 'file';
	lastmod: string;
	size: number;
	etag: string;
}

const DEFAULT_SETTINGS: NextcloudPluginSettings = {
	nextcloudUrl: 'https://your-nextcloud-instance.com',
	username: '',
	password: '',
	collectivePath: '/Collectives',
	syncInterval: 5,
	syncOnStartup: true,
	syncOnSave: true,
	localFolderPath: ''
}

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudPluginSettings;
	client: WebDAVClient | null = null;
	statusBarItem: HTMLElement;
	syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();

		// Set up WebDAV client if credentials are available
		this.setupClient();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('Nextcloud: Not Connected');

		// Add ribbon icon for sync
		const ribbonIconEl = this.addRibbonIcon('sync', 'Sync with Nextcloud Collectives', async (evt: MouseEvent) => {
			await this.syncWithNextcloud();
		});
		ribbonIconEl.addClass('nextcloud-ribbon-class');

		// Add commands
		this.addCommand({
			id: 'sync-with-nextcloud',
			name: 'Sync with Nextcloud Collectives',
			callback: async () => {
				await this.syncWithNextcloud();
			}
		});

		this.addCommand({
			id: 'connect-to-nextcloud',
			name: 'Connect to Nextcloud',
			callback: () => {
				this.setupClient();
				if (this.client) {
					new Notice('Connected to Nextcloud');
					this.statusBarItem.setText('Nextcloud: Connected');
				}
			}
		});

		// Register event handlers
		if (this.settings.syncOnSave) {
			this.registerEvent(
				this.app.vault.on('modify', async (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						await this.uploadFile(file);
					}
				})
			);
		}

		// Set up sync interval if enabled
		if (this.settings.syncInterval > 0) {
			this.startSyncInterval();
		}

		// Sync on startup if enabled
		if (this.settings.syncOnStartup) {
			// Small delay to make sure everything is loaded
			setTimeout(async () => {
				await this.syncWithNextcloud();
			}, 5000);
		}

		// This adds a settings tab
		this.addSettingTab(new NextcloudSettingTab(this.app, this));
	}

	onunload() {
		if (this.syncIntervalId) {
			window.clearInterval(this.syncIntervalId);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Reconnect client when settings change
		this.setupClient();

		// Restart sync interval if needed
		if (this.syncIntervalId) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}

		if (this.settings.syncInterval > 0) {
			this.startSyncInterval();
		}
	}

	setupClient() {
		// Only set up client if we have credentials
		if (!this.settings.nextcloudUrl || !this.settings.username || !this.settings.password) {
			this.client = null;
			this.statusBarItem.setText('Nextcloud: Not Connected');
			return;
		}

		// Create WebDAV client
		this.client = createClient(
			this.settings.nextcloudUrl + '/remote.php/dav/files/' + this.settings.username,
			{
				username: this.settings.username,
				password: this.settings.password
			}
		);

		this.statusBarItem.setText('Nextcloud: Connected');
	}

	startSyncInterval() {
		// Set interval for sync (convert minutes to milliseconds)
		this.syncIntervalId = window.setInterval(
			async () => {
				await this.syncWithNextcloud();
			},
			this.settings.syncInterval * 60 * 1000
		);
	}

	async syncWithNextcloud() {
		if (!this.client) {
			new Notice('Not connected to Nextcloud. Please check your settings.');
			return;
		}

		try {
			// Update status
			this.statusBarItem.setText('Nextcloud: Syncing...');

			// Get local folder path or default to vault root
			const folderPath = this.settings.localFolderPath || '/';

			// First, upload any local changes
			await this.uploadChanges(folderPath);

			// Then, download any remote changes
			await this.downloadChanges(folderPath);

			this.statusBarItem.setText('Nextcloud: Connected');
			new Notice('Sync with Nextcloud Collectives completed');
		} catch (error) {
			console.error('Error syncing with Nextcloud:', error);
			new Notice('Error syncing with Nextcloud: ' + error.message);
			this.statusBarItem.setText('Nextcloud: Error');
		}
	}

	async uploadChanges(folderPath: string) {
		if (!this.client) return;

		// Get all markdown files from the specified folder
		const files = this.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(folderPath));

		for (const file of files) {
			await this.uploadFile(file);
		}
	}

	async uploadFile(file: TFile) {
		if (!this.client) return;

		try {
			// Get file content
			const content = await this.app.vault.read(file);

			// Calculate remote path
			let remotePath = this.settings.collectivePath;
			if (!remotePath.startsWith('/')) {
				remotePath = '/' + remotePath;
			}
			if (!remotePath.endsWith('/')) {
				remotePath += '/';
			}

			// Map local path to remote path
			const localBasePath = this.settings.localFolderPath || '';
			let relativePath = file.path;
			if (localBasePath && file.path.startsWith(localBasePath)) {
				relativePath = file.path.slice(localBasePath.length);
			}
			if (relativePath.startsWith('/')) {
				relativePath = relativePath.slice(1);
			}

			remotePath += relativePath;

			// Ensure directories exist
			await this.ensureDirectoryExists(remotePath.substring(0, remotePath.lastIndexOf('/')));

			// Upload file
			await this.client.putFileContents(remotePath, content, {
				overwrite: true,
				contentLength: content.length
			});
		} catch (error) {
			console.error(`Error uploading file ${file.path}:`, error);
			throw error;
		}
	}

	async downloadChanges(folderPath: string) {
		if (!this.client) return;

		try {
			// Calculate remote path
			let remotePath = this.settings.collectivePath;
			if (!remotePath.startsWith('/')) {
				remotePath = '/' + remotePath;
			}

			// Get remote files
			const remoteFiles = await this.getRemoteFiles(remotePath);

			for (const remoteFile of remoteFiles) {
				if (remoteFile.type === 'file' && remoteFile.basename.endsWith('.md')) {
					// Calculate local path
					let localPath = remoteFile.filename;
					// Remove the collective path prefix
					localPath = localPath.replace(remotePath, '');
					// Add local folder path prefix if set
					if (this.settings.localFolderPath) {
						localPath = this.settings.localFolderPath + localPath;
					}

					// Get remote content
					const content = await this.client.getFileContents(remoteFile.filename, { format: 'text' });

					// Check if file exists locally
					const fileExists = await this.app.vault.adapter.exists(localPath);

					if (fileExists) {
						// Get local content for comparison
						const localContent = await this.app.vault.adapter.read(localPath);

						// If content is different, update local file
						if (content !== localContent) {
							await this.app.vault.adapter.write(localPath, content as string);
						}
					} else {
						// Ensure local directory exists
						const dirPath = localPath.substring(0, localPath.lastIndexOf('/'));
						if (dirPath) {
							// Create directory if it doesn't exist
							try {
								await this.app.vault.createFolder(dirPath);
							} catch (e) {
								// Directory might already exist
							}
						}

						// Create new file
						await this.app.vault.create(localPath, content as string);
					}
				}
			}
		} catch (error) {
			console.error('Error downloading changes:', error);
			throw error;
		}
	}

	async getRemoteFiles(remotePath: string): Promise<RemoteFile[]> {
		if (!this.client) return [];

		// Helper function to get all files recursively
		const getAllFiles = async (directory: string): Promise<RemoteFile[]> => {
			try {
				if (!this.client) return [];
				const contents = await this.client.getDirectoryContents(directory, { deep: true });
				return Array.isArray(contents) ? contents as RemoteFile[] : [];
			} catch (error) {
				// If the directory doesn't exist yet, return empty array
				console.log(`Directory ${directory} not found or inaccessible`);
				return [];
			}
		};

		return await getAllFiles(remotePath);
	}

	async ensureDirectoryExists(directory: string) {
		if (!this.client) return;

		try {
			// Split path into components
			const components = directory.split('/').filter(c => c);
			let currentPath = '';

			// Create each directory level if it doesn't exist
			for (const component of components) {
				currentPath += '/' + component;
				try {
					await this.client.stat(currentPath);
				} catch (error) {
					// Directory doesn't exist, create it
					await this.client.createDirectory(currentPath);
				}
			}
		} catch (error) {
			console.error(`Error ensuring directory exists ${directory}:`, error);
			throw error;
		}
	}
}

class NextcloudSettingTab extends PluginSettingTab {
	plugin: NextcloudPlugin;

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Nextcloud Collectives Sync Settings'});

		containerEl.createEl('h3', {text: 'Connection Settings'});

		new Setting(containerEl)
			.setName('Nextcloud URL')
			.setDesc('The URL of your Nextcloud instance (e.g., https://cloud.example.com)')
			.addText(text => text
				.setPlaceholder('https://your-nextcloud-instance.com')
				.setValue(this.plugin.settings.nextcloudUrl)
				.onChange(async (value) => {
					this.plugin.settings.nextcloudUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Your Nextcloud username')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('Your Nextcloud password (or app password)')
			.addText(text => {
				text.setPlaceholder('password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
				// Use DOM API to set the input type to password
				text.inputEl.type = 'password';
				return text;
			});

		new Setting(containerEl)
			.setName('Collectives Path')
			.setDesc('The path to your Collectives folder in Nextcloud (default is /Collectives)')
			.addText(text => text
				.setPlaceholder('/Collectives')
				.setValue(this.plugin.settings.collectivePath)
				.onChange(async (value) => {
					this.plugin.settings.collectivePath = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', {text: 'Sync Settings'});

		new Setting(containerEl)
			.setName('Local Folder Path')
			.setDesc('Local folder to sync with Nextcloud Collectives (leave empty for vault root)')
			.addText(text => text
				.setPlaceholder('folder/path')
				.setValue(this.plugin.settings.localFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.localFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync Interval (minutes)')
			.setDesc('How often to automatically sync (0 to disable)')
			.addSlider(slider => slider
				.setLimits(0, 60, 5)
				.setValue(this.plugin.settings.syncInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.syncInterval = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync on Startup')
			.setDesc('Sync with Nextcloud when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync on Save')
			.setDesc('Upload files to Nextcloud when they are modified')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncOnSave)
				.onChange(async (value) => {
					this.plugin.settings.syncOnSave = value;
					await this.plugin.saveSettings();
				}));

		// Add button to test connection
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Test your Nextcloud connection')
			.addButton(button => button
				.setButtonText('Test')
				.setCta()
				.onClick(async () => {
					try {
						this.plugin.setupClient();
						if (!this.plugin.client) {
							new Notice('Please configure your Nextcloud connection first');
							return;
						}

						// Try to access the root directory
						await this.plugin.client.getDirectoryContents('/');
						new Notice('Connection to Nextcloud successful!');
					} catch (error) {
						console.error('Connection test failed:', error);
						new Notice('Connection failed: ' + error.message);
					}
				}));

		// Add button to manually trigger sync
		new Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Manually sync with Nextcloud Collectives')
			.addButton(button => button
				.setButtonText('Sync Now')
				.setCta()
				.onClick(async () => {
					await this.plugin.syncWithNextcloud();
				}));
	}
}
