import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Projects from './components/Projects';
import ProjectFiles from './components/ProjectFiles';
import './styles/App.css';
import { ThemeProvider, createTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Make auth instance globally available for API client
function setGlobalAuthInstance(auth) {
  window.authInstance = auth;
  return null;
}

function PrivateRoute({ children }) {
  const auth = useAuth();
  const { t } = useTranslation();
  
  // Set auth instance globally for API client to use
  setGlobalAuthInstance(auth);
  
  // Show loading state while checking authentication
  if (auth.isLoading) {
    return <div>{t('common.app.LOADING')}</div>;
  }
  
  return auth.isAuthenticated ? children : <Navigate to="/login" />;
}

function AppRoutes() {
  const auth = useAuth();
  
  // Set auth instance globally for API client to use
  setGlobalAuthInstance(auth);

  // If user is authenticated, redirect from login to projects
  const renderLogin = () => {
    return auth.isAuthenticated ? <Navigate to="/projects" replace /> : <Login />;
  };

  return (
    <Routes>
      <Route path="/login" element={renderLogin()} />
      <Route
        path="/projects"
        element={
          <PrivateRoute>
            <Projects />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects/:projectId"
        element={
          <PrivateRoute>
            <ProjectFiles />
          </PrivateRoute>
        }
      />
      <Route path="/" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}

const theme = createTheme({
  components: {
    MuiTableRow: {
      styleOverrides: {
        root: {
          height: 'auto'
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '5px'
        },
        head: {
          color: 'white',
          backgroundColor: 'var(--primary-color)', // Using your existing primary color
          fontWeight: 'bold'
        }
      }
    },
    MuiTableSortLabel: {
      styleOverrides: {
        root: {
          color: 'white',
          '&:hover': {
            color: 'white',
          },
          '&.Mui-active': {
            color: 'white',
          },
          '& .MuiTableSortLabel-icon': {
            color: 'white !important'
          }
        }
      }
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: 'none'
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: 'none'
        }
      }
    }
  }
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <Router future={{ 
          v7_startTransition: true,
          v7_relativeSplatPath: true 
        }}>
          <Layout>
            <AppRoutes />
          </Layout>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
