import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/api';
import '../styles/Projects.css';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Menu,
  MenuItem,
  ListItemText,
  CircularProgress,
  Snackbar,
  Alert
} from '@mui/material';
import { RefreshIcon } from './icons';

function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', tags: '' });
  const [checkedProjects, setCheckedProjects] = useState({});
  const [actionsMenuAnchorEl, setActionsMenuAnchorEl] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t } = useTranslation();
  // Add state for notifications
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'info' // 'error', 'warning', 'info', 'success'
  });

  useEffect(() => {
    loadProjects();
  }, []);

  // Handle closing the snackbar
  const handleCloseSnackbar = () => {
    setSnackbar({
      ...snackbar,
      open: false
    });
  };

  const loadProjects = async () => {
    try {
      setIsRefreshing(true);
      const data = await apiClient.getProjects();
      setProjects(data);
      // Reset checked projects when loading new projects
      setCheckedProjects({});
    } catch (error) {
      console.error('Error loading projects:', error);
      setSnackbar({
        open: true,
        message: `${t('error.messages.GENERIC')}: ${error.message}`,
        severity: "error"
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      const tagsArray = newProject.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      const createdProject = await apiClient.createProject({
        name: newProject.name,
        tags: tagsArray
      });
      
      setProjects([...projects, createdProject]);
      setShowCreateModal(false);
      setNewProject({ name: '', tags: '' });
      setSnackbar({
        open: true,
        message: `${t('projects.list.CREATE')} "${createdProject.name}" successful`,
        severity: "success"
      });
    } catch (error) {
      console.error('Error creating project:', error);
      setSnackbar({
        open: true,
        message: `${t('error.messages.GENERIC')}: ${error.message}`,
        severity: "error"
      });
    }
  };

  const handleBulkDelete = async () => {
    const selectedProjectIds = Object.keys(checkedProjects).filter(id => checkedProjects[id]);

    if (selectedProjectIds.length === 0) {
      setSnackbar({
        open: true,
        message: "Please select at least one project to delete.",
        severity: "warning"
      });
      return;
    }

    const isConfirmed = window.confirm(`Are you sure you want to delete ${selectedProjectIds.length} selected project(s)?`);

    if (!isConfirmed) {
      return;
    }

    try {
      // Delete each selected project one by one
      for (const projectId of selectedProjectIds) {
        await apiClient.deleteProject(projectId);
      }

      // Reset checked projects and reload
      setCheckedProjects({});
      await loadProjects();
      setSnackbar({
        open: true,
        message: `Successfully deleted ${selectedProjectIds.length} project(s)`,
        severity: "success"
      });
    } catch (error) {
      console.error('Error deleting projects:', error);
      setSnackbar({
        open: true,
        message: `${t('error.messages.GENERIC')}: ${error.message}`,
        severity: "error"
      });
    }
  };

  const handleCheckboxChange = (projectId) => {
    setCheckedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  const handleSelectAll = (event) => {
    const isChecked = event.target.checked;
    const newCheckedState = {};

    projects.forEach(project => {
      newCheckedState[project.id] = isChecked;
    });

    setCheckedProjects(newCheckedState);
  };

  const formatDateTime = (epochTime) => {
    const date = new Date(epochTime * 1000);

    // Get UTC offset in minutes
    const offsetMinutes = date.getTimezoneOffset();

    // Convert offset to hours and minutes
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const offsetSign = offsetMinutes <= 0 ? '+' : '-';

    // Format the date and time separately
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const formattedDate = dateFormatter.format(date);
    const formattedTime = timeFormatter.format(date);

    // Combine date and time with UTC offset
    return `${formattedDate}, ${formattedTime} (UTC${offsetSign}${offsetHours}:${offsetMins.toString().padStart(2, '0')})`;
  };


  const [orderBy, setOrderBy] = useState('createdAt');
  const [order, setOrder] = useState('desc');

  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);

    const sortedProjects = [...projects].sort((a, b) => {
      if (property === 'name' || property === 'tags') {
        return order === 'asc'
          ? a[property].localeCompare(b[property])
          : b[property].localeCompare(a[property]);
      }
      return order === 'asc'
        ? a[property] - b[property]
        : b[property] - a[property];
    });

    setProjects(sortedProjects);
  };

  // First add these state and functions above your return statement
  const [searchTerm, setSearchTerm] = useState('');

  const filterTable = (data) => {
    if (!searchTerm) return data;

    return data.filter(project => {
      const nameMatch = project.name.toLowerCase().includes(searchTerm.toLowerCase());
      const tagMatch = project.tags.some(tag =>
        tag.toLowerCase().includes(searchTerm.toLowerCase())
      );
      return nameMatch || tagMatch;
    });
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };


  return (
    <div className="projects-container">
      <nav className="breadcrumb">
        <a href="#">{t('common.app.SAMPLE')}</a> &gt; <a href="/">{t('projects.list.TITLE')}</a>
      </nav>

      <div className="projects-header">
        <h2>{t('projects.list.TITLE')} ({projects.length})</h2>
        <div className="actions">
          <button
            onClick={loadProjects}
            disabled={isRefreshing}
            style={{
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 10px',
              marginRight: '5px',
              position: 'relative'
            }}
          >
            {isRefreshing ? (
              <CircularProgress size={20} thickness={5} style={{ color: '#0066cc' }} />
            ) : (
              <RefreshIcon size={24} />
            )}
          </button>
          <button
            className="btn-primary"
            onClick={(e) => setActionsMenuAnchorEl(e.currentTarget)}
            style={{ marginRight: '5px', height: '36px', display: 'flex', alignItems: 'center', gap: '5px' }}
            disabled={isRefreshing || Object.keys(checkedProjects).filter(id => checkedProjects[id]).length === 0}
          >
            {t('projects.list.PROJECT_ACTIONS')}
            <span style={{ fontSize: '10px', marginTop: '2px' }}>
              {Boolean(actionsMenuAnchorEl) ? '▲' : '▼'}
            </span>
          </button>
          <Menu
            anchorEl={actionsMenuAnchorEl}
            open={Boolean(actionsMenuAnchorEl)}
            onClose={() => setActionsMenuAnchorEl(null)}
          >
            <MenuItem onClick={() => {
              handleBulkDelete();
              setActionsMenuAnchorEl(null);
            }}>
              <ListItemText primary={t('common.app.DELETE')} />
            </MenuItem>
          </Menu>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
            disabled={isRefreshing}
          >
            {t('projects.list.CREATE')}
          </button>
        </div>
      </div>

      <div className="search-container">
        <input
          type="text"
          placeholder={t('common.app.SEARCH')}
          value={searchTerm}
          onChange={handleSearch}
        />
      </div>

      <TableContainer component={Paper} >
        <Table sx={{
          '& .MuiTableCell-root': {
            borderLeft: 'none',
            borderRight: 'none'
          }
        }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={projects.length > 0 && Object.keys(checkedProjects).length === projects.length &&
                    Object.values(checkedProjects).every(Boolean)}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate =
                        Object.keys(checkedProjects).length > 0 &&
                        Object.keys(checkedProjects).length < projects.length;
                    }
                  }}
                />
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  {t('projects.list.NAME')}
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'createdAt'}
                  direction={orderBy === 'createdAt' ? order : 'asc'}
                  onClick={() => handleSort('createdAt')}
                >
                  {t('projects.list.CREATED')}
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filterTable(projects).map(project => (
              <TableRow key={project.id}>
                <TableCell padding="checkbox">
                  <input
                    type="checkbox"
                    checked={!!checkedProjects[project.id]}
                    onChange={() => handleCheckboxChange(project.id)}
                  />
                </TableCell>
                <TableCell>
                  <a
                    onClick={() => navigate(`/projects/${project.id}`)}
                    style={{ cursor: 'pointer', color: '#0066cc' }}
                  >
                    {project.name}
                  </a>
                </TableCell>
                <TableCell>{formatDateTime(project.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {showCreateModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>{t('projects.list.CREATE')}</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label htmlFor="projectName">{t('projects.list.NAME')}:</label>
                <input
                  type="text"
                  id="projectName"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-buttons">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowCreateModal(false)}
                >
                  {t('common.app.CANCEL')}
                </button>
                <button type="submit" className="btn-primary">{t('common.app.CREATE')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

export default Projects;
