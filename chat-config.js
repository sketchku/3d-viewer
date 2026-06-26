/** Visitor chat storage config. Set storage to 'firebase' for shared messages across visitors. */
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