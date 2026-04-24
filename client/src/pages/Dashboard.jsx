import { useState, useEffect } from 'react';

const STATUS_COLORS = {
  active: '#1D9E75',
  pending_ack: '#BA7517',
  waitlisted: '#378ADD',
  withdrawn: '#888780',
  rejected: '#E24B4A',
  hired: '#534AB7',
};

export default function Dashboard({ jobId }) {
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
    await fetch(`/api/applications/${appId}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason }),
    });
    fetchPipeline();
  }

  if (!data && loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!data) return null;

  const { job, applications } = data;
  const activeCount = applications.filter(a =>
    ['active', 'pending_ack'].includes(a.status)
  ).length;

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0 }}>{job.title}</h1>
          <p style={{ margin: '4px 0 0', color: '#888' }}>{job.company_name}</p>
        </div>
        <button onClick={fetchPipeline} disabled={loading}
          style={{ padding: '8px 16px', cursor: 'pointer' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
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
                  padding: '2px 8px', borderRadius: '4px', fontSize: '12px'
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
                    <button onClick={() => handleExit(app.id, 'hired')}>Hire</button>
                    <button onClick={() => handleExit(app.id, 'rejected')}>Reject</button>
                    <button onClick={() => handleExit(app.id, 'withdrawn')}>Withdraw</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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