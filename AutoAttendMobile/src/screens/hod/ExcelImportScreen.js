/**
 * HOD — Bulk Student Import via Excel (H-Excel)
 *
 *  1. Pick a target section          GET  /api/sections
 *  2. Pick an .xlsx / .xls file       (expo-document-picker)
 *  3. Upload                          POST /api/sections/assign-students-excel?section_id={id}
 *                                          multipart/form-data { file }
 *  4. Show a result summary           { assigned, not_found_rolls[], section_name }
 *
 *  The spreadsheet must contain a `roll_number` column header. Each matching
 *  student is (re)assigned to the chosen section. HOD-scoped on the backend.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const XLSX_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

function prettySize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ExcelImportScreen() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sectionId, setSectionId] = useState(null);
  const [file, setFile] = useState(null); // { uri, name, size, mimeType }
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { assigned, not_found_rolls, section_name }

  const fetchSections = useCallback(async () => {
    try {
      const { data } = await client.get('/sections');
      setSections(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[ExcelImport] sections error:', err?.message);
    }
  }, []);

  useEffect(() => {
    fetchSections().finally(() => setLoading(false));
  }, [fetchSections]);

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: XLSX_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      const name = asset.name ?? 'spreadsheet.xlsx';
      if (!/\.(xlsx|xls)$/i.test(name)) {
        return Alert.alert('Invalid File', 'Please choose an Excel file (.xlsx or .xls).');
      }
      setFile({ uri: asset.uri, name, size: asset.size, mimeType: asset.mimeType });
      setResult(null);
    } catch (err) {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  const upload = async () => {
    if (!sectionId) return Alert.alert('Validation', 'Select a target section first.');
    if (!file) return Alert.alert('Validation', 'Choose an Excel file to import.');

    const body = new FormData();
    body.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || XLSX_TYPES[0],
    });

    setUploading(true);
    setResult(null);
    try {
      const { data } = await client.post('/sections/assign-students-excel', body, {
        params: { section_id: sectionId },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
    } catch (err) {
      Alert.alert(
        'Import Failed',
        err?.response?.data?.detail ?? 'Upload failed. Please try again.'
      );
    } finally {
      setUploading(false);
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>📥 Import Students</Text>
        <Text style={styles.sub}>
          Upload an Excel sheet with a <Text style={styles.code}>roll_number</Text> column to assign
          existing students to a section.
        </Text>

        {/* Step 1 — Section */}
        <Text style={styles.step}>1 · Target Section</Text>
        {sections.length === 0 ? (
          <Text style={styles.empty}>No sections in your department yet.</Text>
        ) : (
          <View style={styles.chipWrap}>
            {sections.map((s) => {
              const sel = s.id === sectionId;
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, sel && styles.chipSel]}
                  onPress={() => setSectionId(s.id)}
                >
                  <Text style={[styles.chipTxt, sel && styles.chipTxtSel]}>
                    {s.name} · Sem {s.semester}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Step 2 — File */}
        <Text style={styles.step}>2 · Excel File</Text>
        <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.8}>
          <Ionicons name="document-attach-outline" size={20} color={PRIMARY} />
          <Text style={styles.pickTxt}>{file ? 'Change file' : 'Choose .xlsx / .xls'}</Text>
        </TouchableOpacity>
        {file && (
          <View style={styles.fileCard}>
            <Ionicons name="document-text-outline" size={22} color="#16a34a" />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              {file.size != null && <Text style={styles.fileMeta}>{prettySize(file.size)}</Text>}
            </View>
            <TouchableOpacity
              onPress={() => {
                setFile(null);
                setResult(null);
              }}
            >
              <Ionicons name="close-circle" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        )}

        {/* Step 3 — Upload */}
        <TouchableOpacity
          style={[styles.uploadBtn, (!sectionId || !file || uploading) && styles.uploadBtnDisabled]}
          onPress={upload}
          disabled={!sectionId || !file || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
              <Text style={styles.uploadTxt}>Import Students</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Result summary */}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>✅ Import Complete</Text>
            <Text style={styles.resultLine}>
              Assigned <Text style={styles.resultStrong}>{result.assigned ?? 0}</Text> student(s)
              {result.section_name ? ` to ${result.section_name}` : ''}.
            </Text>
            {Array.isArray(result.not_found_rolls) && result.not_found_rolls.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.warnTitle}>
                  ⚠️ {result.not_found_rolls.length} roll number(s) not found:
                </Text>
                <Text style={styles.warnList}>{result.not_found_rolls.join(', ')}</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.note}>
          💡 Tip: the sheet's first row must include a column titled “roll_number”. Only students
          that already exist are matched and assigned.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 18 },
  code: { fontWeight: '800', color: PRIMARY },
  step: { fontSize: 13, fontWeight: '800', color: '#1e293b', marginTop: 22, marginBottom: 8 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipSel: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTxtSel: { color: '#fff' },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  pickTxt: { fontSize: 13, fontWeight: '700', color: PRIMARY },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fileName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  fileMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    padding: 14,
    marginTop: 24,
  },
  uploadBtnDisabled: { backgroundColor: '#cbd5e1' },
  uploadTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  resultTitle: { fontSize: 14, fontWeight: '800', color: '#16a34a', marginBottom: 6 },
  resultLine: { fontSize: 13, color: '#1e293b', lineHeight: 19 },
  resultStrong: { fontWeight: '800', color: PRIMARY },
  warnTitle: { fontSize: 12, fontWeight: '700', color: '#b45309' },
  warnList: { fontSize: 11, color: '#92400e', marginTop: 3 },
  note: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginTop: 24, lineHeight: 17 },
});
