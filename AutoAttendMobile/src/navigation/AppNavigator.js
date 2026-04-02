/**
 * AutoAttend AI — App Navigator
 *
 * Auth gate: shows AuthStack when not authenticated, RoleNavigator when authenticated.
 * Each role gets a BottomTabNavigator with role-appropriate screens.
 *
 * navigationRef is exported so client.js can trigger navigation (e.g. on 401).
 */

import { ActivityIndicator, View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createStackNavigator }     from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons }                 from '@expo/vector-icons';
import * as Linking                 from 'expo-linking';
import { useAuth }                  from '../context/AuthContext';

// ── Auth screens ──────────────────────────────────────────────────────
import LoginScreen          from '../screens/auth/LoginScreen';
import TOTPScreen           from '../screens/auth/TOTPScreen';
import FaceSetupScreen      from '../screens/auth/FaceSetupScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';

// ── Principal screens ─────────────────────────────────────────────────
import PrincipalDashboard     from '../screens/principal/PrincipalDashboard';
import DepartmentsScreen      from '../screens/principal/DepartmentsScreen';
import PrincipalReportsScreen from '../screens/principal/PrincipalReportsScreen';
import PrincipalAlertsScreen  from '../screens/principal/PrincipalAlertsScreen';

// ── HOD screens ───────────────────────────────────────────────────────
import HODDashboard            from '../screens/hod/HODDashboard';
import TeachersScreen          from '../screens/hod/TeachersScreen';
import StudentsScreen          from '../screens/hod/StudentsScreen';
import HODReportsScreen        from '../screens/hod/HODReportsScreen';
import PendingApprovalsScreen  from '../screens/hod/PendingApprovalsScreen';

// ── Teacher screens ───────────────────────────────────────────────────
import TeacherDashboard     from '../screens/teacher/TeacherDashboard';
import QRGenerateScreen     from '../screens/teacher/QRGenerateScreen';
import ClassesScreen        from '../screens/teacher/ClassesScreen';
import TeacherReportsScreen from '../screens/teacher/TeacherReportsScreen';

// ── Student screens ───────────────────────────────────────────────────
import StudentDashboard        from '../screens/student/StudentDashboard';
import ScanQRScreen            from '../screens/student/ScanQRScreen';
import AttendanceHistoryScreen from '../screens/student/AttendanceHistoryScreen';
import TimetableScreen         from '../screens/student/TimetableScreen';

// ── Navigation ref (used by axios interceptor for 401 redirect) ───────
export const navigationRef = createNavigationContainerRef();

// ── Navigators ────────────────────────────────────────────────────────
const AuthStack    = createStackNavigator();
const HODStack     = createStackNavigator();
const PrincipalTab = createBottomTabNavigator();
const HODTab       = createBottomTabNavigator();
const TeacherTab   = createBottomTabNavigator();
const StudentTab   = createBottomTabNavigator();

const PRIMARY = '#1a237e';

// ── Deep linking configuration ────────────────────────────────────────
const linking = {
  prefixes: [Linking.createURL('/'), 'autoattend://'],
  config: {
    screens: {
      ScanQR: 'scan-qr',
      Dashboard: 'dashboard',
      Attendance: 'attendance',
    },
  },
};

const SHARED_TAB_OPTS = {
  tabBarActiveTintColor:   PRIMARY,
  tabBarInactiveTintColor: '#94a3b8',
  tabBarStyle:  { backgroundColor: '#ffffff', borderTopColor: '#e2e8f0', height: 60 },
  tabBarLabelStyle: { fontSize: 11, marginBottom: 6 },
  headerStyle:      { backgroundColor: PRIMARY },
  headerTintColor:  '#ffffff',
  headerTitleStyle: { fontWeight: '700', fontSize: 16 },
};

function icon(name) {
  return ({ color, size }) => <Ionicons name={name} size={size} color={color} />;
}

// ── Auth navigator ────────────────────────────────────────────────────
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login"          component={LoginScreen} />
      <AuthStack.Screen name="TOTP"           component={TOTPScreen} />
      <AuthStack.Screen name="FaceSetup"      component={FaceSetupScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

// ── Principal navigator ───────────────────────────────────────────────
function PrincipalNavigator() {
  return (
    <PrincipalTab.Navigator screenOptions={SHARED_TAB_OPTS}>
      <PrincipalTab.Screen
        name="Dashboard"   component={PrincipalDashboard}
        options={{ title: 'Dashboard',   tabBarIcon: icon('home-outline') }}
      />
      <PrincipalTab.Screen
        name="Departments" component={DepartmentsScreen}
        options={{ title: 'Departments', tabBarIcon: icon('business-outline') }}
      />
      <PrincipalTab.Screen
        name="Reports"     component={PrincipalReportsScreen}
        options={{ title: 'Reports',     tabBarIcon: icon('bar-chart-outline') }}
      />
      <PrincipalTab.Screen
        name="Alerts"      component={PrincipalAlertsScreen}
        options={{ title: 'Alerts',      tabBarIcon: icon('notifications-outline') }}
      />
    </PrincipalTab.Navigator>
  );
}

// ── HOD navigator ─────────────────────────────────────────────────────
function HODTabNavigator() {
  return (
    <HODTab.Navigator screenOptions={SHARED_TAB_OPTS}>
      <HODTab.Screen
        name="Dashboard" component={HODDashboard}
        options={{ title: 'Dashboard', tabBarIcon: icon('home-outline') }}
      />
      <HODTab.Screen
        name="Teachers"  component={TeachersScreen}
        options={{ title: 'Teachers',  tabBarIcon: icon('people-outline') }}
      />
      <HODTab.Screen
        name="Students"  component={StudentsScreen}
        options={{ title: 'Students',  tabBarIcon: icon('school-outline') }}
      />
      <HODTab.Screen
        name="Reports"   component={HODReportsScreen}
        options={{ title: 'Reports',   tabBarIcon: icon('bar-chart-outline') }}
      />
    </HODTab.Navigator>
  );
}

function HODNavigator() {
  return (
    <HODStack.Navigator screenOptions={{ headerShown: false }}>
      <HODStack.Screen name="HODTabs"           component={HODTabNavigator} />
      <HODStack.Screen name="PendingApprovals"  component={PendingApprovalsScreen} />
    </HODStack.Navigator>
  );
}

// ── Teacher navigator ─────────────────────────────────────────────────
function TeacherNavigator() {
  return (
    <TeacherTab.Navigator screenOptions={SHARED_TAB_OPTS}>
      <TeacherTab.Screen
        name="Dashboard"  component={TeacherDashboard}
        options={{ title: 'Dashboard',   tabBarIcon: icon('home-outline') }}
      />
      <TeacherTab.Screen
        name="GenerateQR" component={QRGenerateScreen}
        options={{ title: 'Generate QR', tabBarIcon: icon('qr-code-outline') }}
      />
      <TeacherTab.Screen
        name="Classes"    component={ClassesScreen}
        options={{ title: 'Classes',     tabBarIcon: icon('book-outline') }}
      />
      <TeacherTab.Screen
        name="Reports"    component={TeacherReportsScreen}
        options={{ title: 'Reports',     tabBarIcon: icon('bar-chart-outline') }}
      />
    </TeacherTab.Navigator>
  );
}

// ── Student navigator ─────────────────────────────────────────────────
function StudentNavigator() {
  return (
    <StudentTab.Navigator screenOptions={SHARED_TAB_OPTS}>
      <StudentTab.Screen
        name="Dashboard"  component={StudentDashboard}
        options={{ title: 'Dashboard',  tabBarIcon: icon('home-outline') }}
      />
      <StudentTab.Screen
        name="ScanQR"     component={ScanQRScreen}
        options={{ title: 'Scan QR',    tabBarIcon: icon('scan-outline') }}
      />
      <StudentTab.Screen
        name="Attendance" component={AttendanceHistoryScreen}
        options={{ title: 'Attendance', tabBarIcon: icon('checkmark-circle-outline') }}
      />
      <StudentTab.Screen
        name="Timetable"  component={TimetableScreen}
        options={{ title: 'Timetable',  tabBarIcon: icon('calendar-outline') }}
      />
    </StudentTab.Navigator>
  );
}

// ── Role dispatcher ───────────────────────────────────────────────────
function RoleNavigator() {
  const { user } = useAuth();
  switch (user?.role) {
    case 'principal': return <PrincipalNavigator />;
    case 'hod':       return <HODNavigator />;
    case 'teacher':   return <TeacherNavigator />;
    default:          return <StudentNavigator />;
  }
}

// ── Loading ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
      <ActivityIndicator size="large" color={PRIMARY} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Root navigator
// ═══════════════════════════════════════════════════════════════════════
export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      {isAuthenticated ? <RoleNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
