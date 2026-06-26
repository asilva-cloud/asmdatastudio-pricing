import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './Dashboard.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Dashboard({ token, onLogout }) {
  const [step, setStep] = useState(1);
  const [analisis, setAnalisis] = useState(null);
  const [escenarios, setEscenarios] = useState([]);
  const [precioSimulado, setPrecioSimulado] = useState(null);
  const [recomendacion, setRecomendacion] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/api/analizar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        setAnalisis(data);
        setPrecioSimulado(data.precio_promedio);
        setStep(2);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSimular = async () => {
    if (!analisis || !precioSimulado) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/simular`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          nuevo_precio: precioSimulado,
          elasticidad: analisis.elasticidad,
          precio_actual: analisis.precio_promedio,
          volumen_actual: analisis.volumen_promedio,
          costo_unitario: analisis.costo_promedio
        })
      });

      const escenario = await res.json();
      setEscenarios([...escenarios, escenario]);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecomendacion = async () => {
    if (!analisis || escenarios.length === 0) return;
    setLoading(true);
    try {
      const escenarios_texto = escenarios
        .map((e, i) => `Escenario ${i+1}: $${e.nuevo_precio.toFixed(2)} → Margen $${e.margen_total.toFixed(2)}`)
        .join('\n');

      const res = await fetch(`${API_URL}/api/recomendar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          elasticidad: analisis.elasticidad,
          precio_actual: analisis.precio_promedio,
          volumen_actual: analisis.volumen_promedio,
          costo_unitario: analisis.costo_promedio,
          margen_actual: analisis.margen_actual,
          ingresos_actuales: analisis.precio_promedio * analisis.volumen_promedio,
          escenarios_texto
        })
      });

      const data = await res.json();
      setRecomendacion(data.recomendacion);
      setStep(3);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>💰 Sensibilidad de Precios</h1>
        <button onClick={onLogout} className="logout-btn">Salir</button>
      </header>

      <div className="container">
        {step === 1 && (
          <div className="step">
            <h2>Paso 1: Sube tu CSV</h2>
            <p>Columnas: <code>precio, volumen_vendido, costo_unitario</code></p>
            <div className="upload-zone">
              <input type="file" onChange={handleUpload} accept=".csv" disabled={loading} />
            </div>
            {analisis && (
              <div className="analysis-summary">
                <h3>✅ Analizado</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>Elasticidad</td>
                      <td><strong>{analisis.elasticidad.toFixed(2)}</strong></td>
                    </tr>
                    <tr>
                      <td>Precio Promedio</td>
                      <td><strong>${analisis.precio_promedio.toFixed(2)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {step >= 2 && analisis && (
          <div className="step">
            <h2>Paso 2: Simula Precios</h2>
            <label>Precio: <strong>${precioSimulado?.toFixed(2)}</strong></label>
            <input 
              type="range" 
              min={analisis.precio_promedio * 0.7} 
              max={analisis.precio_promedio * 1.3}
              value={precioSimulado}
              onChange={(e) => setPrecioSimulado(parseFloat(e.target.value))}
            />
            <button onClick={handleSimular} disabled={loading}>Agregar Escenario</button>

            {escenarios.length > 0 && (
              <div className="results">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={escenarios}>
                    <CartesianGrid />
                    <XAxis dataKey="nuevo_precio" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="margen_total" stroke="#2ecc71" name="Margen Total" />
                  </LineChart>
                </ResponsiveContainer>

                <table className="scenarios-table">
                  <thead>
                    <tr>
                      <th>Precio</th>
                      <th>Margen Total</th>
                      <th>Ingresos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escenarios.map((s, i) => (
                      <tr key={i}>
                        <td>${s.nuevo_precio.toFixed(2)}</td>
                        <td>${s.margen_total.toFixed(2)}</td>
                        <td>${s.ingresos.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button onClick={handleRecomendacion} disabled={loading} className="btn-primary">
                  Obtener Recomendación IA
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && recomendacion && (
          <div className="step">
            <h2>Recomendación</h2>
            <div className="recommendation-box">
              <p>{recomendacion}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
