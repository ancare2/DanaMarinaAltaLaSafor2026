import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { supabase } from './lib/supabase';

type TaskType = 'need' | 'offer';
type TaskStatus = 'open' | 'claimed' | 'in_progress' | 'completed' | 'cancelled';
type FilterType = 'all' | TaskType;

type Task = {
  id: string;
  created_by: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  municipality: string;
  latitude: number;
  longitude: number;
  created_at: string;
  expires_at: string | null;
  completed_at: string | null;
};

function MapClickHandler({
  onChoose,
}: {
  onChoose: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(event) {
      onChoose(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [type, setType] = useState<TaskType>('need');
  const [latitude, setLatitude] = useState<number | null>(38.84);
  const [longitude, setLongitude] = useState<number | null>(-0.12);

  const loadTasks = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('tasks')
      .select('*')
      .in('status', ['open', 'claimed', 'in_progress'])
      .order('created_at', { ascending: false });

    if (queryError) {
      throw queryError;
    }

    setTasks((data ?? []) as Task[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      setLoading(true);
      setError('');

      try {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        let currentUser = sessionData.session?.user ?? null;

        if (!currentUser) {
          const { data, error: signInError } =
            await supabase.auth.signInAnonymously();

          if (signInError) throw signInError;
          currentUser = data.user;
        }

        if (!currentUser) {
          throw new Error('No s’ha pogut crear la sessió anònima.');
        }

        if (mounted) setUserId(currentUser.id);

        const { data: taskData, error: queryError } = await supabase
          .from('tasks')
          .select('*')
          .in('status', ['open', 'claimed', 'in_progress'])
          .order('created_at', { ascending: false });

        if (queryError) throw queryError;

        if (mounted) setTasks((taskData ?? []) as Task[]);
      } catch (err) {
        console.error(err);
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : 'No s’ha pogut connectar amb Supabase.',
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void initialise();

    return () => {
      mounted = false;
    };
  }, []);

  function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null) {
      const details = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const parts = [details.message, details.details, details.hint]
        .filter((part) => typeof part === 'string' && part.trim().length > 0)
        .map(String);
      if (parts.length > 0) {
        return details.code ? `[${String(details.code)}] ${parts.join(' — ')}` : parts.join(' — ');
      }
    }
    return fallback;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!userId) {
      setError('No hi ha una sessió anònima activa. Recarrega la pàgina.');
      return;
    }

    if (latitude === null || longitude === null) {
      setError('Selecciona una ubicació al mapa abans de publicar.');
      return;
    }

    if (title.trim().length < 3) {
      setError('El títol ha de tindre almenys 3 caràcters.');
      return;
    }

    setSaving(true);

    try {
      const { error: insertError } = await supabase.from('tasks').insert({
        created_by: userId,
        title: title.trim(),
        description: description.trim(),
        municipality: municipality.trim(),
        type,
        status: 'open',
        latitude,
        longitude,
      });

      if (insertError) throw insertError;

      await loadTasks();
      setTitle('');
      setDescription('');
      setMunicipality('');
      setType('need');
      setMessage('Publicació creada correctament.');
    } catch (err: unknown) {
      console.error('Error en publicar la tasca:', err);
      setError(getErrorMessage(err, 'No s’ha pogut publicar la tasca.'));
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(task: Task) {
    if (task.created_by !== userId) {
      setError('Només qui ha publicat aquesta tasca pot completar-la.');
      return;
    }

    setError('');
    setMessage('');

    try {
      const { error: updateError } = await supabase
        .from('tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      if (updateError) throw updateError;

      await loadTasks();
      setMessage('Tasca marcada com a completada.');
    } catch (err: unknown) {
      console.error('Error en completar la tasca:', err);
      setError(getErrorMessage(err, 'No s’ha pogut marcar la tasca com a completada.'));
    }
  }

  const visibleTasks = tasks.filter(
    (task) => filter === 'all' || task.type === filter,
  );

  return (
    <main className="app">
      <header className="app-header">
        <h1>Suport mutu DANA</h1>
        <p>Marina Alta i la Safor · Necessitats, ofertes i ajuda comunitària</p>
      </header>

      <section className="panel">
        <h2>Mapa de suport mutu</h2>
        <p>
          Selecciona un punt del mapa per indicar on es necessita o s’ofereix
          ajuda.
        </p>

        <div className="map-wrapper">
          <MapContainer
            center={[38.84, -0.12]}
            zoom={10}
            style={{ height: '100%', minHeight: '380px', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapClickHandler
              onChoose={(lat, lng) => {
                setLatitude(lat);
                setLongitude(lng);
              }}
            />

            {visibleTasks.map((task) => (
              <CircleMarker
                key={task.id}
                center={[task.latitude, task.longitude]}
                radius={9}
                pathOptions={{
                  color: task.type === 'need' ? '#b42318' : '#16794b',
                  fillColor: task.type === 'need' ? '#ef4444' : '#22c55e',
                  fillOpacity: 0.8,
                }}
              >
                <Popup>
                  <strong>{task.title}</strong>
                  <p>{task.type === 'need' ? 'Necessitat' : 'Oferta d’ajuda'}</p>
                  {task.municipality && <p>{task.municipality}</p>}
                  {task.description && <p>{task.description}</p>}
                  {task.created_by === userId && (
                    <button type="button" onClick={() => void completeTask(task)}>
                      Marcar com a completada
                    </button>
                  )}
                </Popup>
              </CircleMarker>
            ))}

            {latitude !== null && longitude !== null && (
              <CircleMarker
                center={[latitude, longitude]}
                radius={6}
                pathOptions={{
                  color: '#1d4ed8',
                  fillColor: '#60a5fa',
                  fillOpacity: 0.8,
                }}
              >
                <Popup>Ubicació seleccionada per a la nova publicació</Popup>
              </CircleMarker>
            )}
          </MapContainer>
        </div>

        <p className="location-status">
          {latitude !== null && longitude !== null
            ? `Ubicació seleccionada: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
            : 'Encara no has seleccionat cap ubicació.'}
        </p>

        <div className="filters" aria-label="Filtrar publicacions">
          <button type="button" onClick={() => setFilter('all')}>
            Totes
          </button>
          <button type="button" onClick={() => setFilter('need')}>
            Necessitats
          </button>
          <button type="button" onClick={() => setFilter('offer')}>
            Ofertes
          </button>
          <span>{visibleTasks.length} publicacions</span>
        </div>
      </section>

      <section className="panel">
        <h2>Publica una necessitat o una oferta</h2>

        <form onSubmit={handleSubmit} className="task-form">
          <label>
            Tipus de publicació
            <select
              value={type}
              onChange={(event) => setType(event.target.value as TaskType)}
            >
              <option value="need">Necessite ajuda</option>
              <option value="offer">Oferisc ajuda</option>
            </select>
          </label>

          <label>
            Títol
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
              maxLength={120}
              placeholder="Ex.: Necessitem aigua potable"
            />
          </label>

          <label>
            Municipi
            <input
              value={municipality}
              onChange={(event) => setMunicipality(event.target.value)}
              maxLength={100}
              placeholder="Ex.: Oliva"
            />
          </label>

          <label>
            Descripció
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Explica què cal o quina ajuda pots oferir."
            />
          </label>

          <button type="submit" disabled={saving || loading || !userId}>
            {saving ? 'Publicant…' : 'Publicar al mapa'}
          </button>
        </form>
      </section>

      {loading && <p role="status">Connectant i carregant publicacions…</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status" className="success-message">{message}</p>}

      <footer className="app-footer">
        <p>
          Espai comunitari de suport mutu. No publiques dades personals,
          adreces particulars ni informació sensible de persones afectades.
        </p>
      </footer>
    </main>
  );

}
