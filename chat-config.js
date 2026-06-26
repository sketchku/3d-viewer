/**
 * Visitor chat storage config.
 * Run setup-firebase-chat.bat to enable Firebase shared chat.
 * See firebase/SETUP.txt for manual steps.
 */
export const CHAT_CONFIG = {
  storage: 'local',
  maxMessages: 300,
  firebase: {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
  },
};