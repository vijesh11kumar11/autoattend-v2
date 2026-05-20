/**
 * Shared — Career Roadmap (S4 / T8 / cross-role)
 * POST /api/career/generate { career_goal, current_skills[], hours_per_week, experience_level }
 * GET  /api/career/saved
 * POST /api/career/save { career_goal, roadmap_data }
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const LEVELS = ['beginner', 'intermediate', 'advanced'];

export default function CareerRoadmapScreen() {
  const [saved, setSaved]       = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [goal, setGoal]         = useState('');
  const [skills, setSkills]     = useState('');
  const [hours, setHours]       = useState('10');
  const [level, setLevel]       = useState('beginner');
  const [generating, setGenerating] = useState(false);
  const [result, setResult]     = useState(null);
  const [showForm, setShowForm] = useState(true);

  const fetchSaved = useCallback(async () => {
    try {
      const { data } = await client.get('/career/saved');
      setSaved(Array.isArray(data) ? data : []);
    } catch (err) { console.warn('[Career] saved fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchSaved().finally(() => setLoadingSaved(false)); }, [fetchSaved]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchSaved(); setRefreshing(false); }, [fetchSaved]);

  const generate = async () => {
    if (goal.trim().length < 2) return Alert.alert('Required', 'Please enter a career goal.');
    setGenerating(true); setResult(null);
    try {
      const skillList = skills.split(',').map(s => s.trim()).filter(Boolean);
      const { data } = await client.post('/career/generate', {
        career_goal: goal.trim(),
        current_skills: skillList,
        hours_per_week: Math.max(5, Math.min(30, parseInt(hours, 10) || 10)),
        experience_level: level,
      });
      setResult(data?.roadmap ?? data);
      setShowForm(false);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not generate roadmap.');
    } finally { setGenerating(false); }
  };

  const saveRoadmap = async () => {
    if (!result) return;
    try {
      await client.post('/career/save', { career_goal: goal.trim(), roadmap_data: result });
      Alert.alert('Saved', 'Roadmap saved.');
      fetchSaved();
    } catch (err) { Alert.alert('Error', 'Save failed.'); }
  };

  const loadRoadmap = (r) => {
    setGoal(r.career_goal ?? '');
    setResult(r.roadmap_data ?? null);
    setShowForm(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
          <Text style={styles.heading}>🚀 Career Roadmap</Text>
          <Text style={styles.sub}>AI-generated personalised path powered by Gemini.</Text>

          <View style={styles.tabs}>
            <TouchableOpacity style={[styles.tab, showForm && styles.tabActive]} onPress={() => setShowForm(true)}>
              <Text style={[styles.tabTxt, showForm && styles.tabTxtActive]}>Generate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, !showForm && styles.tabActive]} onPress={() => setShowForm(false)}>
              <Text style={[styles.tabTxt, !showForm && styles.tabTxtActive]}>Result / Saved</Text>
            </TouchableOpacity>
          </View>

          {showForm ? (
            <View style={styles.card}>
              <Text style={styles.label}>Career Goal *</Text>
              <TextInput style={styles.input} value={goal} onChangeText={setGoal}
                placeholder="e.g. Backend Engineer at FAANG" placeholderTextColor="#94a3b8" maxLength={100} />

              <Text style={styles.label}>Current Skills (comma-separated)</Text>
              <TextInput style={[styles.input, { minHeight: 60 }]} value={skills} onChangeText={setSkills}
                placeholder="e.g. Python, SQL, React" placeholderTextColor="#94a3b8" multiline />

              <Text style={styles.label}>Hours per Week (5–30)</Text>
              <TextInput style={styles.input} value={hours} onChangeText={setHours}
                placeholder="10" placeholderTextColor="#94a3b8" keyboardType="number-pad" />

              <Text style={styles.label}>Experience Level</Text>
              <View style={styles.chipRow}>
                {LEVELS.map(lv => (
                  <TouchableOpacity key={lv} style={[styles.chip, level === lv && styles.chipActive]} onPress={() => setLevel(lv)}>
                    <Text style={[styles.chipTxt, level === lv && styles.chipTxtActive]}>{lv}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={[styles.btn, generating && { opacity: 0.6 }]} onPress={generate} disabled={generating}>
                {generating
                  ? <ActivityIndicator color="#fff" />
                  : <><Ionicons name="sparkles-outline" size={18} color="#fff" /><Text style={styles.btnTxt}>Generate Roadmap</Text></>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {result && (
                <View style={styles.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={[styles.label, { flex: 1, marginTop: 0 }]}>Generated Roadmap</Text>
                    <TouchableOpacity onPress={saveRoadmap}>
                      <Ionicons name="bookmark-outline" size={22} color={PRIMARY} />
                    </TouchableOpacity>
                  </View>
                  <RoadmapBlock data={result} />
                </View>
              )}

              <Text style={[styles.label, { marginTop: 18 }]}>Saved Roadmaps</Text>
              {loadingSaved ? (
                <ActivityIndicator color={PRIMARY} style={{ marginTop: 16 }} />
              ) : saved.length === 0 ? (
                <Text style={styles.empty}>No saved roadmaps yet.</Text>
              ) : (
                saved.map(r => (
                  <TouchableOpacity key={r.id} style={styles.savedRow} onPress={() => loadRoadmap(r)}>
                    <Ionicons name="document-text-outline" size={18} color={PRIMARY} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.savedTitle}>{r.career_goal}</Text>
                      <Text style={styles.savedDate}>{r.generated_at?.slice(0, 10) ?? ''}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                  </TouchableOpacity>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoadmapBlock({ data }) {
  if (!data) return null;
  // Roadmap can be: { phases: [...] } or { milestones: [...] } or array
  const phases = data.phases ?? data.milestones ?? data.steps ?? (Array.isArray(data) ? data : []);
  if (!phases.length && data.summary) {
    return <Text style={{ fontSize: 13, color: '#1e293b', lineHeight: 20 }}>{String(data.summary)}</Text>;
  }
  if (!phases.length) {
    return <Text style={{ fontSize: 11, color: '#94a3b8' }} selectable>{JSON.stringify(data, null, 2)}</Text>;
  }
  return (
    <View>
      {data.summary ? <Text style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 20 }}>{String(data.summary)}</Text> : null}
      {phases.map((p, i) => (
        <View key={i} style={styles.phaseCard}>
          <View style={styles.phaseHead}>
            <View style={styles.phaseDot}><Text style={styles.phaseDotTxt}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.phaseTitle}>{p.title ?? p.name ?? p.phase ?? `Phase ${i + 1}`}</Text>
              {p.duration && <Text style={styles.phaseMeta}>{p.duration}</Text>}
            </View>
          </View>
          {p.description && <Text style={styles.phaseDesc}>{p.description}</Text>}
          {Array.isArray(p.skills) && p.skills.length > 0 && (
            <View style={styles.tags}>
              {p.skills.map((s, j) => <View key={j} style={styles.tag}><Text style={styles.tagTxt}>{String(s)}</Text></View>)}
            </View>
          )}
          {Array.isArray(p.resources) && p.resources.length > 0 && (
            <>
              <Text style={styles.subLabel}>Resources</Text>
              {p.resources.map((r, j) => (
                <Text key={j} style={styles.resource}>• {typeof r === 'string' ? r : (r.title ?? r.name ?? JSON.stringify(r))}</Text>
              ))}
            </>
          )}
          {Array.isArray(p.tasks) && p.tasks.length > 0 && (
            <>
              <Text style={styles.subLabel}>Tasks</Text>
              {p.tasks.map((t, j) => (
                <Text key={j} style={styles.resource}>✓ {typeof t === 'string' ? t : (t.title ?? JSON.stringify(t))}</Text>
              ))}
            </>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 14 },
  tabs: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 10, padding: 3, marginBottom: 14 },
  tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#fff' },
  tabTxt: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#475569', textTransform: 'capitalize' },
  chipTxtActive: { color: '#fff' },
  btn: { flexDirection: 'row', backgroundColor: PRIMARY, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', marginTop: 12 },
  savedRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 6 },
  savedTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  savedDate: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  phaseCard: { backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: PRIMARY },
  phaseHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  phaseDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  phaseDotTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  phaseTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  phaseMeta: { fontSize: 11, color: '#64748b', marginTop: 1 },
  phaseDesc: { fontSize: 12, color: '#475569', lineHeight: 18, marginBottom: 8 },
  subLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginTop: 6, marginBottom: 4 },
  resource: { fontSize: 12, color: '#475569', marginVertical: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tag: { backgroundColor: '#e8eaf6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagTxt: { fontSize: 10, color: PRIMARY, fontWeight: '700' },
});
