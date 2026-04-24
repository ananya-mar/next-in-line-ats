import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';

// --- Dashboard Components ---

const STATUS_COLORS = {
  active: '#1D9E75',
  pending_ack: '#BA7517',
  waitlisted: '#378ADD',
  withdrawn: '#888780',
  rejected: '#E24B4A',
  hired: '#534AB7',
};

function Stat({ label, value }) {
  return (
    <div style={{
      border: '1px solid #eee', borderRadius: '8px',
      padding: '12px 20px', minWidth: '120px'
    }}>
      <div style={{ fontSize: '22px', fontWeight: 500 }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#888' }}>{label}</div>
    </div>
  );
}

function Dashboard({ jobId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function fetchPipeline() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/pipeline`);
      if (!res.ok) throw new Error('Failed to load pipeline');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPipeline(); }, [jobId]);

  async function handleExit(appId, status) {
    const reason = prompt(`Reason for marking as ${status}?`);
    if (!reason) return;
    await fetch(`/api/applications/${appId}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason }),
    });
    fetchPipeline();
  }

  if (!data && loading) return <p style={{ padding: '24px' }}>Loading pipeline data...</p>;
  if (error) return <p style={{ color: 'red', padding: '24px' }}>{error}</p>;
  if (!data) return null;

  const { job, applications } = data;
  const activeCount = applications.filter(a =>
    ['active', 'pending_ack'].includes(a.status)
  ).length;

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0 }}>{job.title}</h1>
          <p style={{ margin: '4px 0 0', color: '#888' }}>{job.company_name} (Job ID: {job.id})</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to="/" style={{ padding: '8px 16px', background: '#eee', textDecoration: 'none', color: '#333', borderRadius: '4px' }}>Home</Link>
          <button onClick={fetchPipeline} disabled={loading}
            style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ccc' }}>
            {loading ? 'Refreshing...' : 'Refresh Pipeline'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <Stat label="Active capacity" value={`${activeCount} / ${job.active_capacity}`} />
        <Stat label="Waitlisted" value={applications.filter(a => a.status === 'waitlisted').length} />
        <Stat label="Total applied" value={applications.length} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th style={{ padding: '8px' }}>Name</th>
            <th style={{ padding: '8px' }}>Email</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>Queue pos.</th>
            <th style={{ padding: '8px' }}>Ack deadline</th>
            <th style={{ padding: '8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {applications.map(app => (
            <tr key={app.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{app.applicant_name}</td>
              <td style={{ padding: '8px' }}>{app.applicant_email}</td>
              <td style={{ padding: '8px' }}>
                <span style={{
                  background: STATUS_COLORS[app.status] + '22',
                  color: STATUS_COLORS[app.status],
                  padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600
                }}>
                  {app.status}
                </span>
              </td>
              <td style={{ padding: '8px' }}>
                {app.waitlist_position ?? '—'}
              </td>
              <td style={{ padding: '8px' }}>
                {app.ack_deadline
                  ? new Date(app.ack_deadline).toLocaleString()
                  : '—'}
              </td>
              <td style={{ padding: '8px', display: 'flex', gap: '6px' }}>
                {['active', 'pending_ack'].includes(app.status) && (
                  <>
                    <button style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => handleExit(app.id, 'hired')}>Hire</button>
                    <button style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => handleExit(app.id, 'rejected')}>Reject</button>
                    <button style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => handleExit(app.id, 'withdrawn')}>Withdraw</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {applications.length === 0 && (
            <tr>
              <td colSpan="6" style={{ padding: '16px', textAlign: 'center', color: '#888' }}>
                No applicants yet. Share the Job ID to get applications!
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- Applicant Status Component ---

function ApplicantStatus() {
  const [appId, setAppId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ackMsg, setAckMsg] = useState(null);

  async function checkStatus() {
    if (!appId.trim()) return;
    setLoading(true); setError(null); setData(null); setAckMsg(null);
    try {
      const res = await fetch(`/api/applications/${appId.trim()}/status`);
      if (!res.ok) throw new Error('Application not found. Check the ID and try again.');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function acknowledge() {
    try {
      const res = await fetch(`/api/applications/${appId.trim()}/acknowledge`, {
        method: 'POST'
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAckMsg('Acknowledged! You are now active.');
      checkStatus();
    } catch (err) {
      setAckMsg(`Error: ${err.message}`);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ marginBottom: '24px' }}>
         <Link to="/" style={{ padding: '8px 16px', background: '#eee', textDecoration: 'none', color: '#333', borderRadius: '4px' }}>&larr; Back Home</Link>
      </div>
      <h2>Check your application status</h2>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={appId}
          onChange={e => setAppId(e.target.value)}
          placeholder="Paste your Application ID here"
          style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button onClick={checkStatus} disabled={loading} style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ccc' }}>
          {loading ? 'Searching...' : 'Check'}
        </button>
      </div>

      {error && <p style={{ color: 'red', background: '#ffe6e6', padding: '12px', borderRadius: '4px' }}>{error}</p>}

      {data && (
        <div style={{ border: '1px solid #eee', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: '12px' }}>Application Details</h3>
          <p><strong>Applicant Name:</strong> {data.applicant_name}</p>
          <p><strong>Job Role:</strong> {data.job_title} at {data.company_name}</p>
          <p>
            <strong>Current Status:</strong>{' '}
            <span style={{ background: STATUS_COLORS[data.status] + '22', color: STATUS_COLORS[data.status], padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
              {data.status.toUpperCase()}
            </span>
          </p>

          {data.status === 'waitlisted' && (
            <div style={{ marginTop: '16px', padding: '12px', background: '#f5f9ff', borderRadius: '6px', borderLeft: '4px solid #378ADD' }}>
              <p style={{ margin: 0 }}><strong>Queue position:</strong> {data.waitlist_position}</p>
              {data.ahead_in_queue !== undefined && (
                <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#666' }}>
                  There are {data.ahead_in_queue} people ahead of you in line. You will be automatically promoted when a spot opens up.
                </p>
              )}
            </div>
          )}

          {data.status === 'pending_ack' && (
            <div style={{ marginTop: '16px', background: '#FFF8E1', padding: '16px', borderRadius: '6px', borderLeft: '4px solid #BA7517' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#BA7517' }}>Action Required!</h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '14px' }}>
                You've been promoted! You must acknowledge this promotion by{' '}
                <strong>{new Date(data.ack_deadline).toLocaleString()}</strong>
                {' '}or you will be sent back to the waitlist.
              </p>
              <button onClick={acknowledge} style={{ padding: '8px 16px', background: '#BA7517', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                Acknowledge Promotion
              </button>
              {ackMsg && <p style={{ marginTop: '12px', marginBottom: 0, fontWeight: 'bold' }}>{ackMsg}</p>}
            </div>
          )}

          {data.status === 'active' && (
            <div style={{ marginTop: '16px', padding: '12px', background: '#e6ffe6', borderRadius: '6px', borderLeft: '4px solid #1D9E75' }}>
              <p style={{ margin: 0, color: '#1D9E75', fontWeight: 'bold' }}>You are actively under review by the team.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main App & Navigation ---

function DashboardWrapper() {
  const { jobId } = useParams();
  return <Dashboard jobId={jobId} />;
}

function Home() {
  const navigate = useNavigate();
  
  const [jobTitle, setJobTitle] = useState('Software Engineer');
  const [capacity, setCapacity] = useState(2);

  const [dashboardJobId, setDashboardJobId] = useState('');
  const [applyJobId, setApplyJobId] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [applyMessage, setApplyMessage] = useState(null);

  async function handleCreateJob(e) {
    e.preventDefault();
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobTitle,
          company_name: 'TechCorp',
          active_capacity: parseInt(capacity, 10)
        })
      });
      
      if (res.ok) {
        const newJob = await res.json();
        navigate(`/dashboard/${newJob.id}`);
      } else {
        alert('Failed to create job.');
      }
    } catch (err) {
      alert('Error connecting to backend.');
    }
  }

  async function handleApply(e) {
    e.preventDefault();
    setApplyMessage(null);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: applyJobId.trim(),
          applicant_name: applicantName,
          applicant_email: applicantEmail
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        setApplyMessage({
          type: 'success',
          text: `Success! Your Application ID is: ${data.id} (Save this to check your status!)`
        });
        setApplicantName('');
        setApplicantEmail('');
      } else {
        setApplyMessage({ type: 'error', text: data.error || 'Failed to apply.' });
      }
    } catch (err) {
      setApplyMessage({ type: 'error', text: 'Failed to submit application. Is the server running?' });
    }
  }

  return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>Next-In-Line ATS</h1>
      
      <div style={{ border: '1px solid #ccc', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
        <h3 style={{ marginTop: 0 }}> Company: Create a New Job Opening</h3>
        <form onSubmit={handleCreateJob} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <input 
            value={jobTitle} 
            onChange={e => setJobTitle(e.target.value)} 
            placeholder="Job Title"
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} required
          />
          <input 
            type="number" 
            value={capacity} 
            onChange={e => setCapacity(e.target.value)} 
            placeholder="Active Capacity"
            min="1"
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} required
          />
          <button type="submit" style={{ padding: '12px', background: '#378ADD', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Create Job & Go To Dashboard
          </button>
        </form>
      </div>

      <div style={{ border: '1px solid #ccc', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
        <h3 style={{ marginTop: 0 }}> Applicant: Apply for a Job</h3>
        <p style={{ color: '#666', fontSize: '14px', margin: '0 0 12px 0' }}>Paste a Job ID here to submit a test application.</p>
        <form onSubmit={handleApply} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <input 
            value={applyJobId} 
            onChange={e => setApplyJobId(e.target.value)} 
            placeholder="Paste Job ID here"
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} required
          />
          <input 
            value={applicantName} 
            onChange={e => setApplicantName(e.target.value)} 
            placeholder="Your Name"
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} required
          />
          <input 
            type="email"
            value={applicantEmail} 
            onChange={e => setApplicantEmail(e.target.value)} 
            placeholder="Your Email"
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} required
          />
          <button type="submit" style={{ padding: '12px', background: '#534AB7', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Submit Application
          </button>
        </form>
        {applyMessage && (
          <div style={{ marginTop: '16px', padding: '12px', background: applyMessage.type === 'success' ? '#e6ffe6' : '#ffe6e6', color: applyMessage.type === 'success' ? '#1D9E75' : '#E24B4A', borderRadius: '4px', wordBreak: 'break-all' }}>
            <strong>{applyMessage.text}</strong>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #ccc', padding: '24px', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}> Applicant: Check Status</h3>
        <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px 0' }}>Already applied? Check your waitlist position or acknowledge a promotion.</p>
        <Link to="/status" style={{ display: 'inline-block', padding: '12px 20px', background: '#1D9E75', color: 'white', textDecoration: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
          Go to Applicant Portal
        </Link>
      </div>

      <div style={{ border: '1px solid #ccc', padding: '24px', borderRadius: '8px', marginTop: '24px' }}>
        <h3 style={{ marginTop: 0 }}> Company: Go to Job Dashboard</h3>
        <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px 0' }}>Enter a Job ID to view its dashboard with the pipeline of applicants.</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input 
            value={dashboardJobId} 
            onChange={e => setDashboardJobId(e.target.value)} 
            placeholder="Enter Job ID"
            onKeyDown={e => e.key === 'Enter' && dashboardJobId.trim() && navigate(`/dashboard/${dashboardJobId.trim()}`)}
            style={{ flex: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          <button 
            onClick={() => dashboardJobId.trim() && navigate(`/dashboard/${dashboardJobId.trim()}`)}
            disabled={!dashboardJobId.trim()}
            style={{ padding: '10px 20px', background: dashboardJobId.trim() ? '#378ADD' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: dashboardJobId.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
          >
            Go to Dashboard
          </button>
        </div>
      </div>

    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard/:jobId" element={<DashboardWrapper />} />
        <Route path="/status" element={<ApplicantStatus />} />
      </Routes>
    </BrowserRouter>
  );
}