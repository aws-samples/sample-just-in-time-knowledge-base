import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Translation resources
const resources = {
  en: {
    translation: {
      // Common
      'common.app.TITLE': 'Sample Just In Time Knowledge Base',
      'common.app.LOADING': 'Loading...',
      'common.app.ERROR': 'An error occurred',
      'common.app.SUBMIT': 'Submit',
      'common.app.CANCEL': 'Cancel',
      'common.app.DELETE': 'Delete',
      'common.app.CREATE': 'Create',
      'common.app.UPLOAD': 'Upload',
      'common.app.SEARCH': 'Search',
      'common.app.SEND': 'Send',
      'common.app.LOGOUT': 'Logout',
      'common.app.SESSION_EXPIRE': 'Your session has expired. Please log in again.',
      'common.app.SAMPLE': 'Sample',
      'common.app.WELCOME_SAMPLE': 'Welcome to the sample',
      
      // Login
      'auth.login.TITLE': 'Sign In',
      'auth.login.USERNAME': 'Username',
      'auth.login.PASSWORD': 'Password',
      'auth.login.SIGNIN': 'Sign In',
      'auth.login.ERROR': 'Invalid username or password',
      'auth.login.NEED_ACCOUNT': 'Need an account? Sign up',
      'auth.login.FORGOT_PASSWORD': 'Forgot password?',
      'auth.login.HAVE_ACCOUNT': 'Already have an account? Sign in',
      'auth.login.SIGNUP': 'Sign Up',
      'auth.login.EMAIL_VERIFICATION': 'Email Verification Required',
      'auth.login.VERIFICATION_SENT': 'A verification link has been sent to',
      'auth.login.CHECK_EMAIL': 'Please check your email and click the link to verify your account.',
      'auth.login.AFTER_VERIFICATION': 'After verification, you can sign in to your account.',
      'auth.login.RETURN_SIGNIN': 'Return to Sign In',
      'auth.login.RESET_PASSWORD': 'Reset Password',
      'auth.login.SEND_RESET': 'Send Reset Code',
      'auth.login.BACK_SIGNIN': 'Back to Sign In',
      'auth.login.CONFIRMATION_CODE': 'Confirmation Code',
      
      // Projects
      'projects.list.TITLE': 'Projects',
      'projects.list.CREATE': 'Create Project',
      'projects.list.NAME': 'Project Name',
      'projects.list.DESCRIPTION': 'Description',
      'projects.list.NO_PROJECTS': 'No projects found',
      'projects.list.TENANT': 'Tenant',
      'projects.list.CREATED': 'Created',
      'projects.list.ACTIONS': 'Actions',
      'projects.list.PROJECT_ACTIONS': 'Project Actions',
      
      // Project Files
      'files.list.TITLE': 'Files',
      'files.list.UPLOAD': 'Upload Files',
      'files.list.NAME': 'File Name',
      'files.list.SIZE': 'Size',
      'files.list.TYPE': 'Type',
      'files.list.UPLOADED': 'Uploaded',
      'files.list.EXPIRES': 'Expires',
      'files.list.STATUS': 'Status',
      'files.list.NO_FILES': 'No files found',
      'files.list.DROPZONE': 'Drag and drop files here, or click to select files',
      'files.list.MAX_SIZE': 'Maximum file size:',
      'files.list.SEARCH': 'Find files',
      'files.list.UPLOAD_DATE': 'Upload date',
      'files.list.PROJECT_FILES': 'Files',
      'files.actions.DELETE': 'Please select at least one file to delete.',
      'files.actions.DOWNLOAD': 'Please select at least one file to download.',
      'files.actions.FILE_ACTIONS': 'File Actions',
      'chat.interface.ASK_ABOUT_FILES': 'Ask questions about this project and its files.',
      
      // Chat
      'chat.interface.TITLE': 'Chat',
      'chat.interface.PLACEHOLDER': 'Ask a question about your documents...',
      'chat.interface.NO_MESSAGES': 'No messages yet',
      'chat.interface.THINKING': 'Thinking...',
      'chat.interface.ERROR': 'Failed to get response',
      'chat.interface.ASK_QUESTION': 'Ask a question about this project...',
      'chat.interface.NEW_CHAT': 'New Chat',
      'chat.interface.DOWNLOAD_HISTORY': 'Download chat history',
      'chat.interface.CONFIRM_NEW_CHAT': 'Are you sure you want to start a new chat? This will clear all current conversation history.',
      'chat.interface.ASK_ABOUT_PROJECT': 'Ask questions about this project',
      'chat.interface.EXAMPLE_QUESTIONS': 'For example: "What are the key topics in these documents?" or "Summarize the content of these files"',
      'chat.interface.SOURCES': 'Sources',
      'chat.interface.DOCUMENT': 'Document',
      
      // Navigation
      'nav.menu.PROJECTS': 'Projects',
      'nav.menu.FILES': 'Files',
      'nav.menu.CHAT': 'Chat',
      
      // Errors
      'error.messages.GENERIC': 'Something went wrong',
      'error.messages.LOGIN': 'Login failed',
      'error.messages.UPLOAD': 'Upload failed',
      'error.messages.FILE_SIZE': 'File is too large',
      'error.messages.FILE_TYPE': 'File type not supported',
      'error.messages.PROJECT_LIMIT': 'Project limit reached',
      'error.messages.FILE_LIMIT': 'File limit reached',
      'error.messages.DOWNLOAD': 'Failed to download file',
      'error.messages.CHAT_HISTORY': 'Failed to download chat history'
    }
  },
  // Add more languages as needed
  // es: {
  //   translation: {
  //     // Spanish translations
  //   }
  // }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
