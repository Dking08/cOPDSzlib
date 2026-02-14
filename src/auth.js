/**
 * Lightweight download-tracking module
 * Library Genesis doesn't require authentication — this just tracks daily download counts.
 */

let dailyDownloads = 0;
let dailyReset = new Date().toDateString();

function trackDownload() {
  const today = new Date().toDateString();
  if (today !== dailyReset) { dailyDownloads = 0; dailyReset = today; }
  dailyDownloads++;
}

function getDownloadCount() {
  const today = new Date().toDateString();
  if (today !== dailyReset) { dailyDownloads = 0; dailyReset = today; }
  return dailyDownloads;
}

function getStatus() {
  return {
    source: 'Library Genesis',
    downloads: {
      today: getDownloadCount(),
      limit: 'unlimited',
    },
  };
}

module.exports = {
  trackDownload,
  getDownloadCount,
  getStatus,
};
