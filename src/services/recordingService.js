const {
  listByStudent,
  downloadRecording,
  canFetchRecordings,
  RECORDING_PATH,
} = require("../integrations/speak2goClient");
const { badGateway } = require("../utils/AppError");

/**
 * Recordings held on the Speak2Go platform, as opposed to files uploaded
 * through the operator UI.
 */

const listAvailableRecordings = () => ({
  fetchEnabled: canFetchRecordings(),
  endpoint: RECORDING_PATH,
  students: listByStudent(),
});

/**
 * Pulls one recording to local disk.
 *
 * A failure here is the platform's, not the caller's, so it surfaces as a 502
 * rather than a 500 — the distinction matters when someone is working out
 * whether to retry or to fix their request.
 */
async function fetchRecording({ userEmail, idDetection }) {
  try {
    const localPath = await downloadRecording({ userEmail, idDetection });
    return { ok: true, localPath };
  } catch (err) {
    throw badGateway(err.message);
  }
}

module.exports = { listAvailableRecordings, fetchRecording };
