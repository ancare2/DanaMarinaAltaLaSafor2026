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

// Garanteix que cada visitant tinga una sessió de Supabase Auth.
// Els usuaris anònims de Supabase Auth tenen un UUID i el rol "authenticated".
async function ensureAnonymousUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const existingUser = sessionData.session?.user;
  if (existingUser) return existingUser;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `No s'ha pogut iniciar la sessió anònima. Comprova que Anonymous Sign-Ins estiga activat en Supabase. ${error.message}`,
    );
  }

  if (!data.user) {
    throw new Error('Supabase no ha retornat cap usuari per a la sessió anònima.');
  }

  return data.user;
}

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

function normaliseMunicipality(value: string) {
  return value.trim().toLocaleLowerCase('ca');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ca-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
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

    if (queryError) throw queryError;
    setTasks((data ?? []) as Task[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      setLoading(true);
      setError('');

      try {
        const currentUser = await ensureAnonymousUser();
        if (!mounted) return;

        setUserId(currentUser.id);

        const { data: taskData, error: queryError } = await supabase
          .from('tasks')
          .select('*')
          .in('status', ['open', 'claimed', 'in_progress'])
          .order('created_at', { ascending: false });

        if (queryError) throw queryError;
        if (mounted) setTasks((taskData ?? []) as Task[]);
      } catch (err) {
        console.error('Error en iniciar l’aplicació:', err);
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
      if (parts.length > 0) return details.code ? `[${String(details.code)}] ${parts.join(' — ')}` : parts.join(' — ');
    }
    return fallback;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (latitude === null || longitude === null) {
      setError('Selecciona una ubicació al mapa abans de publicar.');
      return;
    }
    if (title.trim().length < 3) {
      setError('El títol ha de tindre almenys 3 caràcters.');
      return;
    }
    if (municipality.trim().length < 2) {
      setError('Indica el municipi perquè les persones puguen trobar l’ajuda local.');
      return;
    }

    setSaving(true);
    try {
      // Revalida la sessió just abans de publicar i usa l'UUID real de Supabase.
      const currentUser = await ensureAnonymousUser();
      setUserId(currentUser.id);

      const { error: insertError } = await supabase.from('tasks').insert({
        created_by: currentUser.id,
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
      setMessage(
        type === 'need'
          ? 'Necessitat publicada. Les ofertes del mateix municipi apareixeran com a possibles coincidències.'
          : 'Oferta publicada. Ara es mostrarà al costat de les necessitats del mateix municipi.',
      );
    } catch (err: unknown) {
      console.error('Error en publicar la tasca:', err);
      setError(getErrorMessage(err, 'No s’ha pogut publicar la tasca.'));
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(task: Task) {
    if (task.type !== 'need') {
      setError('Només es poden marcar com a completades les necessitats d’ajuda.');
      return;
    }
    if (task.created_by !== userId) {
      setError('Només qui ha publicat aquesta tasca pot marcar-la com a completada.');
      return;
    }
    setError('');
    setMessage('');
    try {
      const { error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', task.id);
      if (updateError) throw updateError;
      await loadTasks();
      setMessage('Publicació marcada com a completada.');
    } catch (err: unknown) {
      console.error('Error en completar la tasca:', err);
      setError(getErrorMessage(err, 'No s’ha pogut completar la publicació.'));
    }
  }

  const visibleTasks = tasks.filter((task) => filter === 'all' || task.type === filter);
  const needs = visibleTasks.filter((task) => task.type === 'need');
  const offers = visibleTasks.filter((task) => task.type === 'offer');
  const allNeeds = tasks.filter((task) => task.type === 'need');

  function renderTaskCard(task: Task) {
    const matchingNeeds = task.type === 'offer' && task.municipality
      ? allNeeds.filter((need) =>
          normaliseMunicipality(need.municipality) === normaliseMunicipality(task.municipality) &&
          need.id !== task.id)
      : [];

    return (
      <article className={`task-card task-card--${task.type}`} key={task.id}>
        <div className="task-card__topline">
          <span className={`task-kind task-kind--${task.type}`}>
            {task.type === 'need' ? 'Necessita ajuda' : 'Ofereix ajuda'}
          </span>
          <span className="task-date">{formatDate(task.created_at)}</span>
        </div>
        <h3>{task.title}</h3>
        <p className="task-municipality"><span aria-hidden="true">⌖</span> {task.municipality || 'Municipi no indicat'}</p>
        {task.description && <p className="task-description">{task.description}</p>}

        {task.type === 'offer' && (
          <div className="matching-needs">
            <h4>Necessitats del mateix municipi</h4>
            {matchingNeeds.length > 0 ? (
              <ul>
                {matchingNeeds.slice(0, 3).map((need) => (
                  <li key={need.id}>
                    <strong>{need.title}</strong>
                    <span>{need.municipality}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="matching-empty">Encara no hi ha necessitats publicades amb aquest municipi. Si una persona necessita ajuda ací, la seua publicació apareixerà en aquesta secció.</p>
            )}
          </div>
        )}

        <div className="task-card__footer">
          <span className="task-owner">{task.created_by === userId ? 'Publicat per tu' : 'Publicació comunitària'}</span>
          {task.created_by === userId && task.type === 'need' && (
            <button className="button button--small button--quiet" type="button" onClick={() => void completeTask(task)}>
              Marcar necessitat com a completada
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <div className="eyebrow">Xarxa veïnal · Marina Alta i la Safor</div>
        <h1>Suport mutu <span>DANA ADAM</span></h1>
        <p>Connectem les persones que necessiten ajuda amb les persones que poden oferir-la, municipi a municipi.</p>
        <div className="header-stats">
          <div><strong>{tasks.filter((task) => task.type === 'need').length}</strong><span>necessitats obertes</span></div>
          <div><strong>{tasks.filter((task) => task.type === 'offer').length}</strong><span>ofertes d’ajuda</span></div>
          <div><strong>{new Set(tasks.map((task) => task.municipality.trim()).filter(Boolean).map(normaliseMunicipality)).size}</strong><span>municipis amb activitat</span></div>
        </div>
      </header>

      <section className="panel map-panel">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Vista territorial</span>
            <h2>Mapa de suport mutu</h2>
            <p>Selecciona el punt on es necessita o s’ofereix ajuda. Els punts rojos són necessitats i els verds són ofertes.</p>
          </div>
          <div className="map-legend">
            <span><i className="legend-dot legend-dot--need" /> Necessitat</span>
            <span><i className="legend-dot legend-dot--offer" /> Oferta</span>
          </div>
        </div>

        <div className="map-wrapper">
          <MapContainer center={[38.84, -0.12]} zoom={10} style={{ height: '100%', minHeight: '360px', width: '100%' }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler onChoose={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} />
            {visibleTasks.map((task) => (
              <CircleMarker
                key={task.id}
                center={[task.latitude, task.longitude]}
                radius={9}
                pathOptions={{
                  color: task.type === 'need' ? '#b42318' : '#16794b',
                  fillColor: task.type === 'need' ? '#ef4444' : '#22c55e',
                  fillOpacity: 0.82,
                  weight: 2,
                }}
              >
                <Popup>
                  <strong>{task.title}</strong>
                  <p>{task.type === 'need' ? 'Necessita ajuda' : 'Ofereix ajuda'}</p>
                  <p>{task.municipality || 'Municipi no indicat'}</p>
                  {task.description && <p>{task.description}</p>}
                  {task.created_by === userId && task.type === 'need' && (
                    <button type="button" onClick={() => void completeTask(task)}>Marcar necessitat com a completada</button>
                  )}
                </Popup>
              </CircleMarker>
            ))}
            {latitude !== null && longitude !== null && (
              <CircleMarker center={[latitude, longitude]} radius={6} pathOptions={{ color: '#1d4ed8', fillColor: '#60a5fa', fillOpacity: 0.85 }}>
                <Popup>Ubicació seleccionada per a la nova publicació</Popup>
              </CircleMarker>
            )}
          </MapContainer>
        </div>
        <p className="location-status">
          {latitude !== null && longitude !== null
            ? `Punt seleccionat: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} · Fes clic al mapa per canviar-lo.`
            : 'Selecciona una ubicació al mapa.'}
        </p>
        <div className="filters" aria-label="Filtrar publicacions">
          <button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>Totes <span>{tasks.length}</span></button>
          <button className={filter === 'need' ? 'is-active' : ''} type="button" onClick={() => setFilter('need')}>Necessitats <span>{tasks.filter((task) => task.type === 'need').length}</span></button>
          <button className={filter === 'offer' ? 'is-active' : ''} type="button" onClick={() => setFilter('offer')}>Ofertes <span>{tasks.filter((task) => task.type === 'offer').length}</span></button>
        </div>
      </section>

      <section className="panel publish-panel">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Participa</span>
            <h2>Publica al teu municipi</h2>
            <p>Indica clarament què necessites o què pots oferir perquè siga més fàcil trobar una coincidència.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="task-form">
          <fieldset className="type-choice">
            <legend>Què vols publicar?</legend>
            <label className={type === 'need' ? 'type-choice__option selected' : 'type-choice__option'}>
              <input type="radio" name="type" value="need" checked={type === 'need'} onChange={() => setType('need')} />
              <span className="choice-icon choice-icon--need">↓</span>
              <span><strong>Necessite ajuda</strong><small>Descriu què et fa falta.</small></span>
            </label>
            <label className={type === 'offer' ? 'type-choice__option selected' : 'type-choice__option'}>
              <input type="radio" name="type" value="offer" checked={type === 'offer'} onChange={() => setType('offer')} />
              <span className="choice-icon choice-icon--offer">＋</span>
              <span><strong>Oferisc ajuda</strong><small>Descriu què pots aportar.</small></span>
            </label>
          </fieldset>

          <label className="form-field">
            <span>Títol breu</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={120}
              placeholder={type === 'need' ? 'Ex.: Necessitem aigua potable' : 'Ex.: Puc portar aliments i aigua'} />
          </label>

          <label className="form-field">
            <span>Municipi <b>obligatori</b></span>
            <input value={municipality} onChange={(event) => setMunicipality(event.target.value)} required minLength={2} maxLength={100}
              placeholder="Ex.: Oliva, Pego, Gandia…" />
            <small>Les ofertes i necessitats del mateix municipi es mostraran juntes per facilitar el contacte.</small>
          </label>

          <label className="form-field">
            <span>Detalls</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000}
              placeholder={type === 'need' ? 'Què necessites, quina quantitat i quan? No inclogues dades personals.' : 'Què pots oferir, en quin horari i amb quina disponibilitat?'} />
          </label>

          <button className="button button--primary" type="submit" disabled={saving || loading || !userId}>
            {saving ? 'Publicant…' : type === 'need' ? 'Publicar necessitat' : 'Publicar oferta d’ajuda'}
          </button>
        </form>
      </section>

      <section className="task-board">
        <div className="board-heading">
          <div><span className="section-kicker">Tauler comunitari</span><h2>Qui necessita ajuda i qui en pot oferir?</h2></div>
          <span className="board-count">{visibleTasks.length} publicacions actives</span>
        </div>
        <div className="task-columns">
          {(filter === 'all' || filter === 'need') && (
            <section className="task-column">
              <div className="task-column__heading task-column__heading--need">
                <span className="column-symbol">↓</span><div><h3>Es necessita ajuda</h3><p>Necessitats pendents de cobrir</p></div><strong>{needs.length}</strong>
              </div>
              {needs.length ? <div className="task-list">{needs.map(renderTaskCard)}</div> : <div className="empty-state"><strong>No hi ha necessitats publicades</strong><p>Quan algú demane ajuda, apareixerà ací.</p></div>}
            </section>
          )}
          {(filter === 'all' || filter === 'offer') && (
            <section className="task-column">
              <div className="task-column__heading task-column__heading--offer">
                <span className="column-symbol">＋</span><div><h3>S’ofereix ajuda</h3><p>Recursos i suport disponibles</p></div><strong>{offers.length}</strong>
              </div>
              {offers.length ? <div className="task-list">{offers.map(renderTaskCard)}</div> : <div className="empty-state"><strong>No hi ha ofertes publicades</strong><p>Quan algú oferisca ajuda, apareixerà ací.</p></div>}
            </section>
          )}
        </div>
      </section>

      {loading && <p role="status" className="notice">Connectant i carregant publicacions…</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status" className="success-message">{message}</p>}

      <footer className="app-footer">
        <strong>Una xarxa de suport, poble a poble.</strong>
        <p>Per protegir les persones afectades, no publiques adreces particulars, telèfons ni altra informació personal o sensible.</p>
      </footer>
    </main>
  );
}
