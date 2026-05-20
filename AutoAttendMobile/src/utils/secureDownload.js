/**
 * secureDownload — authenticated file download helper
 *
 * Uses expo-file-system's downloadAsync with the JWT auth header attached,
 * then opens the file with expo-sharing so the user can save / share / open it.
 *
 * Why not Linking.openURL()? — Linking opens the URL in a browser, which has
 * no access to our JWT in SecureStore. Any report URL hit that way bypasses
 * authentication entirely (a critical data-leak risk for attendance reports).
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing    from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';
import { API_BASE_URL } from '../config';

const TOKEN_KEY = 'aa_auth_token';

function sanitizeFileName(name) {
  return String(name || 'report').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

function extFromContentType(ct) {
  if (!ct) return 'bin';
  const lower = String(ct).toLowerCase();
  if (lower.includes('pdf'))   return 'pdf';
  if (lower.includes('spreadsheetml') || lower.includes('excel') || lower.includes('xlsx')) return 'xlsx';
  if (lower.includes('csv'))   return 'csv';
  if (lower.includes('json'))  return 'json';
  return 'bin';
}

/**
 * Download a file from the AutoAttend API with the JWT auth header attached,
 * then open the native share sheet so the user can save it.
 *
 * @param {object}   opts
 * @param {string}   opts.path        — server path beginning with `/api/...` OR a full URL
 * @param {string}   opts.fileName    — base file name without extension
 * @param {string}   [opts.fallbackExt='pdf']
 * @param {(p:number)=>void} [opts.onProgress]   — progress callback (0..1)
 *
 * @returns {Promise<string>} the local URI of the downloaded file
 */
export async function downloadAuthenticated({
  path,
  fileName,
  fallbackExt = 'pdf',
  onProgress,
}) {
  if (!path) throw new Error('downloadAuthenticated: path is required');

  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) {
    throw new Error('Not authenticated — please sign in again.');
  }

  const isAbs = /^https?:\/\//i.test(path);
  const url   = isAbs ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const safeName = sanitizeFileName(fileName);
  const tempUri  = `${FileSystem.cacheDirectory}${safeName}.${fallbackExt}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept:        'application/octet-stream, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*',
  };

  let resumable;
  try {
    resumable = FileSystem.createDownloadResumable(
      url,
      tempUri,
      { headers },
      (progress) => {
        if (typeof onProgress === 'function' && progress.totalBytesExpectedToWrite > 0) {
          onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
        }
      },
    );
    const result = await resumable.downloadAsync();

    if (!result || !result.uri) {
      throw new Error('Download did not return a file URI.');
    }

    const status = result.status ?? 0;
    if (status < 200 || status >= 300) {
      // Best-effort cleanup
      try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch {}
      if (status === 401 || status === 403) {
        throw new Error('You are not authorized to download this report.');
      }
      throw new Error(`Server returned HTTP ${status} while downloading the report.`);
    }

    // Fix extension based on Content-Type if the server gave us something different
    const ct = result.headers?.['Content-Type'] || result.headers?.['content-type'];
    const realExt = extFromContentType(ct);
    let finalUri = result.uri;
    if (realExt && realExt !== 'bin' && !finalUri.toLowerCase().endsWith(`.${realExt}`)) {
      const renamed = `${FileSystem.cacheDirectory}${safeName}.${realExt}`;
      try {
        await FileSystem.moveAsync({ from: finalUri, to: renamed });
        finalUri = renamed;
      } catch {
        // keep original name if rename fails
      }
    }
    return finalUri;
  } catch (err) {
    const msg = err?.message || 'Failed to download the file.';
    throw new Error(msg);
  }
}

/**
 * One-shot helper that downloads + opens the share sheet, and pops error alerts.
 */
export async function downloadAndShare({
  path,
  fileName,
  fallbackExt = 'pdf',
  onProgress,
  title = 'Save Report',
}) {
  try {
    const uri = await downloadAuthenticated({ path, fileName, fallbackExt, onProgress });
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert(
        'Saved',
        Platform.OS === 'android'
          ? `File saved to cache:\n${uri}\n\nSharing is not available on this device.`
          : `File saved.\nSharing is not available on this device.`,
      );
      return uri;
    }
    await Sharing.shareAsync(uri, { dialogTitle: title });
    return uri;
  } catch (err) {
    Alert.alert('Download Failed', err?.message || 'Could not download the report.');
    throw err;
  }
}
