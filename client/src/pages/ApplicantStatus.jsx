import { useState } from 'react';

export default function ApplicantStatus() {
  const [appId, setAppId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ackMsg, setAckMsg] = useState(null);

  async function checkStatus() {
    if (!appId.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`/api/applications/${appId.trim()}/status`);
      if (!res.ok) throw new Error('Application not found');
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
    <div style={{ padding: '24px', maxWidth: '500px', margin: '0 auto' }}>
      <h2>Check your application status</h2>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={appId}
          onChange={e => setAppId(e.target.value)}
          placeholder="Your application ID"
          style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button onClick={checkStatus} disabled={loading}>
          {loading ? '...' : 'Check'}
        </button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {data && (
        <div style={{ border: '1px solid #eee', borderRadius: '8px', padding: '16px' }}>
          <p><strong>Name:</strong> {data.applicant_name}</p>
          <p><strong>Job:</strong> {data.job_title} at {data.company_name}</p>
          <p><strong>Status:</strong> {data.status}</p>

          {data.status === 'waitlisted' && (
            <p><strong>Queue position:</strong> {data.waitlist_position}
              {data.ahead_in_queue > 0 && ` (${data.ahead_in_queue} ahead of you)`}
            </p>
          )}

          {data.status === 'pending_ack' && (
            <div style={{ marginTop: '12px', background: '#FFF8E1', padding: '12px', borderRadius: '6px' }}>
              <p style={{ margin: '0 0 8px' }}>
                You've been promoted! Acknowledge by{' '}
                <strong>{new Date(data.ack_deadline).toLocaleString()}</strong>
                {' '}or you'll return to the waitlist.
              </p>
              <button onClick={acknowledge} style={{ padding: '8px 16px' }}>
                Acknowledge
              </button>
              {ackMsg && <p style={{ marginTop: '8px' }}>{ackMsg}</p>}
            </div>
          )}

          {data.status === 'active' && (
            <p style={{ color: '#1D9E75' }}>You are actively under review.</p>
          )}
        </div>
      )}
    </div>
  );
}