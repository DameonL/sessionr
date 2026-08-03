"use client";
import { useState } from 'react';
import { migrateSqlToCosmos, type MigrationResult } from '../../services/api';

/**
 * Public, no-auth page to trigger the one-time Azure SQL -> Cosmos DB data copy.
 * It exists because the Private API is behind EasyAuth and can't be reached until Cosmos holds
 * user records. Remove this route (and the Public MigrateSqlToCosmos function) once the copy is done.
 */
export default function MigratePage() {
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMigrate = async () => {
    if (!confirm('Start migrating data from Azure SQL to Azure Cosmos DB for NoSQL?')) return;
    setMigrating(true);
    setError(null);
    setResult(null);
    try {
      setResult(await migrateSqlToCosmos());
    } catch (err: any) {
      setError(err?.message || 'Migration failed.');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Database migration</h1>
        <p style={{ opacity: 0.8, marginBottom: '1.5rem' }}>
          One-time tool to copy production records from Azure SQL into Azure Cosmos DB for NoSQL.
          Idempotent — safe to run again; it only copies rows Cosmos is still missing.
        </p>

        {result && (
          <div style={{ border: '1px solid #4dd0a5', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', color: '#4dd0a5' }}>✓ {result.message}</h4>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {Object.entries(result.counts).map(([entity, count]) => (
                <li key={entity}>{entity}: {count} copied</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div style={{ border: '1px solid #e57373', borderRadius: 8, padding: '1rem', marginBottom: '1rem', color: '#e57373' }}>
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={handleMigrate}
          disabled={migrating}
          style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: migrating ? 'default' : 'pointer' }}
        >
          {migrating ? 'Migrating data…' : 'Start migration'}
        </button>
      </div>
    </main>
  );
}
