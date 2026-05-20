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
import PrincipalAuditScreen   from '../screens/principal/PrincipalAuditScreen';
import CollegeOverviewScreen  from '../screens/principal/CollegeOverviewScreen';

// ── HOD screens ───────────────────────────────────────────────────────
import HODDashboard            from '../screens/hod/HODDashboard';
import TeachersScreen          from '../screens/hod/TeachersScreen';
import StudentsScreen          from '../screens/hod/StudentsScreen';
import HODReportsScreen        from '../screens/hod/HODReportsScreen';
import PendingApprovalsScreen  from '../screens/hod/PendingApprovalsScreen';
import HODAlertsScreen         from '../screens/hod/HODAlertsScreen';
import TeacherDetailScreen     from '../screens/hod/TeacherDetailScreen';
import StudentDetailScreen     from '../screens/hod/StudentDetailScreen';
import SemesterProgressScreen  from '../screens/hod/SemesterProgressScreen';
import SectionAnalyticsScreen  from '../screens/hod/SectionAnalyticsScreen';
import DeptOverviewScreen      from '../screens/hod/DeptOverviewScreen';

// ── Teacher screens ───────────────────────────────────────────────────
import TeacherDashboard         from '../screens/teacher/TeacherDashboard';
import QRGenerateScreen         from '../screens/teacher/QRGenerateScreen';
import ClassesScreen            from '../screens/teacher/ClassesScreen';
import TeacherReportsScreen     from '../screens/teacher/TeacherReportsScreen';
import AttendanceManageScreen   from '../screens/teacher/AttendanceManageScreen';
import LeaveManagementScreen    from '../screens/teacher/LeaveManagementScreen';
import SubjectAnalyticsScreen     from '../screens/teacher/SubjectAnalyticsScreen';
import TeacherDisputesScreen      from '../screens/teacher/TeacherDisputesScreen';
import LiveSessionDashboardScreen from '../screens/teacher/LiveSessionDashboardScreen';
import TWMDashboardScreen         from '../screens/teacher/TWMDashboardScreen';
import TutorDashboardScreen       from '../screens/teacher/TutorDashboardScreen';
import PreClassBriefScreen        from '../screens/teacher/PreClassBriefScreen';
import SessionHealthReportScreen  from '../screens/teacher/SessionHealthReportScreen';
import MyLiveSessionsScreen       from '../screens/teacher/MyLiveSessionsScreen';
import TeacherAttendanceHistoryScreen from '../screens/teacher/AttendanceHistoryScreen';

// ── Student screens ───────────────────────────────────────────────────
import StudentDashboard        from '../screens/student/StudentDashboard';
import ScanQRScreen            from '../screens/student/ScanQRScreen';
import AttendanceHistoryScreen from '../screens/student/AttendanceHistoryScreen';
import TimetableScreen         from '../screens/student/TimetableScreen';
import LeaveRequestScreen      from '../screens/student/LeaveRequestScreen';
import NotificationsScreen     from '../screens/student/NotificationsScreen';
import DisputeScreen           from '../screens/student/DisputeScreen';
import FeedScreen              from '../screens/student/FeedScreen';
import SuggestionBoxScreen     from '../screens/student/SuggestionBoxScreen';
import LiveSessionScreen       from '../screens/student/LiveSessionScreen';
import AttendanceForecastScreen     from '../screens/student/AttendanceForecastScreen';
import MyTutorScreen                from '../screens/student/MyTutorScreen';
import StudentKnowledgeGraphScreen  from '../screens/student/StudentKnowledgeGraphScreen';
import MySessionsScreen             from '../screens/student/MySessionsScreen';

// ── Shared screens ────────────────────────────────────────────────────
import ProfileScreen            from '../screens/shared/ProfileScreen';
import CareerRoadmapScreen      from '../screens/shared/CareerRoadmapScreen';
import {
  ClassPulseHomeScreen,
  ClassPulseSubjectScreen,
  CapsuleMobileDetailScreen,
  ClassWallMobileScreen,
} from '../screens/student/ClassPulseMobileScreen';
import {
  TeacherClassPulseHomeScreen,
  CapsuleAnalyticsMobileScreen,
  AnswerDoubtMobileScreen,
} from '../screens/teacher/TeacherClassPulseMobileScreen';
// ── Navigation ref (used by axios interceptor for 401 redirect) ───────
export const navigationRef = createNavigationContainerRef();

// ── Navigators ────────────────────────────────────────────────────────
const AuthStack      = createStackNavigator();
const HODStack       = createStackNavigator();
const StudentStack   = createStackNavigator();
const TeacherStack   = createStackNavigator();
const PrincipalStack = createStackNavigator();
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

// Header-right buttons (Notifications + Profile) shown across all role tab navigators.
function makeHeaderRight(navigation, { showNotifications = false } = {}) {
  return () => (
    <View style={{ flexDirection: 'row', marginRight: 12 }}>
      {showNotifications && (
        <Ionicons
          name="notifications-outline" size={22} color="#fff"
          style={{ marginRight: 16 }}
          onPress={() => navigation.navigate('Notifications')}
        />
      )}
      <Ionicons
        name="person-circle-outline" size={24} color="#fff"
        onPress={() => navigation.navigate('Profile')}
      />
    </View>
  );
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
function PrincipalTabNavigator({ navigation }) {
  const headerRight = makeHeaderRight(navigation);
  return (
    <PrincipalTab.Navigator screenOptions={{ ...SHARED_TAB_OPTS, headerRight }}>
      <PrincipalTab.Screen
        name="Dashboard"   component={PrincipalDashboard}
        options={{ title: 'Dashboard',   tabBarIcon: icon('home-outline') }}
      />
      <PrincipalTab.Screen
        name="Overview"    component={CollegeOverviewScreen}
        options={{ title: 'Overview',    tabBarIcon: icon('stats-chart-outline') }}
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
      <PrincipalTab.Screen
        name="Audit"       component={PrincipalAuditScreen}
        options={{ title: 'Audit',       tabBarIcon: icon('time-outline') }}
      />
    </PrincipalTab.Navigator>
  );
}

function PrincipalNavigator() {
  return (
    <PrincipalStack.Navigator screenOptions={{ headerShown: false }}>
      <PrincipalStack.Screen name="PrincipalTabs" component={PrincipalTabNavigator} />
      <PrincipalStack.Screen name="Profile"       component={ProfileScreen} options={{ headerShown: true, title: 'Profile', ...SHARED_TAB_OPTS }} />
    </PrincipalStack.Navigator>
  );
}

// ── HOD navigator ─────────────────────────────────────────────────────
function HODTabNavigator({ navigation }) {
  const headerRight = makeHeaderRight(navigation);
  return (
    <HODTab.Navigator screenOptions={{ ...SHARED_TAB_OPTS, headerRight }}>
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
        name="Alerts"    component={HODAlertsScreen}
        options={{ title: 'Alerts',    tabBarIcon: icon('megaphone-outline') }}
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
      <HODStack.Screen name="LeaveManagement"   component={LeaveManagementScreen} options={{ headerShown: true, title: 'Leave Requests', ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="TeacherDetail"     component={TeacherDetailScreen}    options={{ headerShown: true, title: 'Teacher Detail',   ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="StudentDetail"     component={StudentDetailScreen}    options={{ headerShown: true, title: 'Student Detail',   ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="SemesterProgress"  component={SemesterProgressScreen} options={{ headerShown: true, title: 'Semester Progress', ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="SectionAnalytics"  component={SectionAnalyticsScreen} options={{ headerShown: true, title: 'Section Analytics', ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="DeptOverview"      component={DeptOverviewScreen}     options={{ headerShown: true, title: 'Department Overview', ...SHARED_TAB_OPTS }} />
      <HODStack.Screen name="Profile"           component={ProfileScreen}          options={{ headerShown: true, title: 'Profile', ...SHARED_TAB_OPTS }} />
    </HODStack.Navigator>
  );
}

// ── Teacher navigator ─────────────────────────────────────────────────
function TeacherTabNavigator({ navigation }) {
  const headerRight = makeHeaderRight(navigation);
  return (
    <TeacherTab.Navigator screenOptions={{ ...SHARED_TAB_OPTS, headerRight }}>
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
        name="ClassPulse" component={TeacherClassPulseHomeScreen}
        options={{ title: 'ClassPulse',  tabBarIcon: icon('library-outline') }}
      />
      <TeacherTab.Screen
        name="Reports"    component={TeacherReportsScreen}
        options={{ title: 'Reports',     tabBarIcon: icon('bar-chart-outline') }}
      />
    </TeacherTab.Navigator>
  );
}

function TeacherNavigator() {
  return (
    <TeacherStack.Navigator screenOptions={{ headerShown: false }}>
      <TeacherStack.Screen name="TeacherTabs"      component={TeacherTabNavigator} />
      <TeacherStack.Screen name="CapsuleAnalytics" component={CapsuleAnalyticsMobileScreen} options={{ headerShown: true, ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="AnswerDoubt"      component={AnswerDoubtMobileScreen}      options={{ headerShown: true, ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="AttendanceManage" component={AttendanceManageScreen}       options={{ headerShown: true, title: 'Manage Attendance', ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="LeaveManagement"  component={LeaveManagementScreen}        options={{ headerShown: true, title: 'Leave Requests',    ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="SubjectAnalytics" component={SubjectAnalyticsScreen}       options={{ headerShown: true, title: 'Subject Analytics', ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="Disputes"         component={TeacherDisputesScreen}        options={{ headerShown: true, title: 'Pending Disputes',  ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="LiveSessionDash"  component={LiveSessionDashboardScreen}   options={{ headerShown: true, title: 'Live Session',      ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="LiveSessionDashboard" component={LiveSessionDashboardScreen} options={{ headerShown: true, title: 'Live Session',      ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="TWMDashboard"     component={TWMDashboardScreen}           options={{ headerShown: true, title: 'TWM Sessions',      ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="TutorDashboard"   component={TutorDashboardScreen}         options={{ headerShown: true, title: 'My Wards',          ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="PreClassBrief"    component={PreClassBriefScreen}          options={{ headerShown: true, title: 'Pre-Class Brief',   ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="SessionHealthReport" component={SessionHealthReportScreen} options={{ headerShown: true, title: 'Health Report',     ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="MyLiveSessions"   component={MyLiveSessionsScreen}         options={{ headerShown: true, title: 'My Live Sessions', ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="AttendanceHistory" component={TeacherAttendanceHistoryScreen} options={{ headerShown: true, title: 'Attendance History', ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="CareerRoadmap"    component={CareerRoadmapScreen}          options={{ headerShown: true, title: 'Career Roadmap',   ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="SuggestionBox"    component={SuggestionBoxScreen}          options={{ headerShown: true, title: 'Suggestion Box',   ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="Feed"             component={FeedScreen}                   options={{ headerShown: true, title: 'Feed',             ...SHARED_TAB_OPTS }} />
      <TeacherStack.Screen name="Profile"          component={ProfileScreen}                options={{ headerShown: true, title: 'Profile', ...SHARED_TAB_OPTS }} />
    </TeacherStack.Navigator>
  );
}

// ── Student navigator ─────────────────────────────────────────────────
function StudentTabNavigator({ navigation }) {
  const headerRight = makeHeaderRight(navigation, { showNotifications: true });
  return (
    <StudentTab.Navigator screenOptions={{ ...SHARED_TAB_OPTS, headerRight }}>
      <StudentTab.Screen
        name="Dashboard"  component={StudentDashboard}
        options={{ title: 'Dashboard',  tabBarIcon: icon('home-outline') }}
      />
      <StudentTab.Screen
        name="ScanQR"     component={ScanQRScreen}
        options={{ title: 'Scan QR',    tabBarIcon: icon('scan-outline') }}
      />
      <StudentTab.Screen
        name="ClassPulse" component={ClassPulseHomeScreen}
        options={{ title: 'ClassPulse', tabBarIcon: icon('library-outline') }}
      />
      <StudentTab.Screen
        name="Attendance" component={AttendanceHistoryScreen}
        options={{ title: 'Attendance', tabBarIcon: icon('checkmark-circle-outline') }}
      />
      <StudentTab.Screen
        name="Timetable"  component={TimetableScreen}
        options={{ title: 'Timetable',  tabBarIcon: icon('calendar-outline') }}
      />
      <StudentTab.Screen
        name="Feed"       component={FeedScreen}
        options={{ title: 'Feed',       tabBarIcon: icon('newspaper-outline') }}
      />
    </StudentTab.Navigator>
  );
}

function StudentNavigator() {
  return (
    <StudentStack.Navigator screenOptions={{ headerShown: false }}>
      <StudentStack.Screen name="StudentTabs"        component={StudentTabNavigator} />
      <StudentStack.Screen name="ClassPulseSubject" component={ClassPulseSubjectScreen}   options={{ headerShown: true, ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="CapsuleDetail"     component={CapsuleMobileDetailScreen} options={{ headerShown: true, ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="ClassWall"         component={ClassWallMobileScreen}     options={{ headerShown: true, ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="LeaveRequest"      component={LeaveRequestScreen}        options={{ headerShown: true, title: 'My Leave Requests', ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="Notifications"     component={NotificationsScreen}       options={{ headerShown: true, title: 'Notifications', ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="Dispute"           component={DisputeScreen}             options={{ headerShown: true, title: 'Attendance Dispute', ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="SuggestionBox"     component={SuggestionBoxScreen}       options={{ headerShown: true, title: 'Suggestion Box',     ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="LiveSession"       component={LiveSessionScreen}         options={{ headerShown: true, title: 'Live Session',        ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="AttendanceForecast" component={AttendanceForecastScreen} options={{ headerShown: true, title: 'Attendance Forecast', ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="MyTutor"           component={MyTutorScreen}             options={{ headerShown: true, title: 'My Tutor',            ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="KnowledgeGraph"    component={StudentKnowledgeGraphScreen} options={{ headerShown: true, title: 'Knowledge Graph',    ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="MySessions"        component={MySessionsScreen}          options={{ headerShown: true, title: 'My Sessions',         ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="CareerRoadmap"     component={CareerRoadmapScreen}       options={{ headerShown: true, title: 'Career Roadmap',      ...SHARED_TAB_OPTS }} />
      <StudentStack.Screen name="Profile"           component={ProfileScreen}             options={{ headerShown: true, title: 'Profile', ...SHARED_TAB_OPTS }} />
    </StudentStack.Navigator>
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
