import { useRef, useState, type ChangeEvent } from 'react'
import { Download, FileUp, ShieldCheck, Trash2 } from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import { CURRENT_SCHEMA_VERSION } from '../../domain/budget/models'
import { parseAppData } from '../../domain/budget/schema'

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function BackupPage() {
  const { data, replaceData, resetData } = useBudget()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const exportBackup = () => {
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(`mon-budget-${date}.json`, data)
    setIsError(false)
    setMessage('La sauvegarde JSON a été téléchargée.')
  }

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const parsed = parseAppData(JSON.parse(await file.text()))
      const budgetCount = parsed.budgetMonths.length
      const transactionCount = parsed.importedTransactions.length
      if (
        !window.confirm(
          `Remplacer les données actuelles par ${budgetCount} budget(s) et ${transactionCount} opération(s) provenant de « ${file.name} » ?`,
        )
      ) {
        return
      }
      await replaceData(parsed)
      setIsError(false)
      setMessage(
        `${budgetCount} budget(s) et ${transactionCount} opération(s) ont été restaurés.`,
      )
    } catch (importError) {
      setIsError(true)
      setMessage(
        importError instanceof Error
          ? `Sauvegarde invalide : ${importError.message}`
          : 'Ce fichier ne contient pas une sauvegarde valide.',
      )
    }
  }

  const reset = async () => {
    if (
      !window.confirm(
        'Effacer tous les budgets locaux et recréer un mois vide ? Exportez une sauvegarde avant de continuer.',
      )
    ) {
      return
    }
    await resetData()
    setIsError(false)
    setMessage('Les données locales ont été réinitialisées.')
  }

  return (
    <main className="content-page narrow-page">
      <div className="page-intro">
        <p className="eyebrow">Données locales</p>
        <div className="page-title-with-icon">
          <span aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <h1>Sauvegarde et restauration</h1>
        </div>
        <p>
          Votre budget reste dans ce navigateur. Conservez régulièrement une
          copie JSON, notamment sur iPhone où le système peut libérer le
          stockage d’un site inutilisé.
        </p>
      </div>

      {message && (
        <div
          className={`notice ${isError ? 'notice-error' : 'notice-success'}`}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </div>
      )}

      <div className="settings-group">
      <section className="settings-card">
        <span className="settings-icon is-primary" aria-hidden="true">
          <Download size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Exporter</p>
          <h2>Télécharger une copie</h2>
          <p>
            La sauvegarde contient {data.budgetMonths.length} budget(s) et{' '}
            {data.importedTransactions.length} opération(s), au format de
            données version {CURRENT_SCHEMA_VERSION}.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={exportBackup}>
          <Download aria-hidden="true" size={17} />
          Télécharger le JSON
        </button>
      </section>

      <section className="settings-card">
        <span className="settings-icon is-secondary" aria-hidden="true">
          <FileUp size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Restaurer</p>
          <h2>Importer une sauvegarde</h2>
          <p>
            Le fichier est entièrement vérifié avant de remplacer les données
            locales.
          </p>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importBackup(event)}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden="true" size={17} />
          Choisir un fichier
        </button>
      </section>
      </div>

      <section className="settings-card danger-zone">
        <span className="settings-icon is-danger" aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Zone sensible</p>
          <h2>Réinitialiser l’application</h2>
          <p>
            Tous les budgets et toutes les opérations importées de cet appareil
            seront remplacés par un mois vide.
          </p>
        </div>
        <button type="button" className="danger-button" onClick={() => void reset()}>
          <Trash2 aria-hidden="true" size={17} />
          Tout réinitialiser
        </button>
      </section>
    </main>
  )
}
