import FinanceKit
import Foundation
import Supabase

/// Supabase settings from Info.plist, filled by `ios/Config/Supabase.xcconfig`.
nonisolated struct CloudConfig: Sendable {
    let url: URL
    let publishableKey: String

    static func fromBundle(_ bundle: Bundle = .main) -> CloudConfig? {
        guard
            let urlText = bundle.object(forInfoDictionaryKey: "SupabaseURL") as? String,
            let key = bundle.object(forInfoDictionaryKey: "SupabasePublishableKey") as? String,
            !key.isEmpty, let url = URL(string: urlText), url.host() != nil
        else { return nil }
        return CloudConfig(url: url, publishableKey: key)
    }
}

nonisolated enum CloudError: Error, LocalizedError {
    case accountChanged
    case unexpectedResponse

    var errorDescription: String? {
        switch self {
        case .accountChanged: "Please sign in again before syncing."
        case .unexpectedResponse: "The cloud sent an unexpected response. Your local data is safe."
        }
    }
}

/// The single cloud document of one user: `public.finance_documents`, read
/// under row-level security and written only through `save_finance_document`.
/// Mirrors `src/data/cloud/SupabaseTransport.ts`.
nonisolated struct SupabaseDocumentStore: RemoteDocumentStore {
    let client: SupabaseClient
    let userId: UUID

    /// Refuses to read or write when the session belongs to someone else.
    private func checkIdentity() async throws {
        let session = try await client.auth.session
        guard session.user.id == userId else { throw CloudError.accountChanged }
    }

    func fetch() async throws -> RemoteSnapshot? {
        try await checkIdentity()
        let response = try await client.from("finance_documents")
            .select("data,revision")
            .eq("user_id", value: userId.uuidString.lowercased())
            .limit(1)
            .execute()
        guard let rows = try JSONSerialization.jsonObject(with: response.data) as? [[String: Any]] else {
            throw CloudError.unexpectedResponse
        }
        guard let row = rows.first else { return nil }
        guard let revision = row["revision"] as? Int, revision >= 1,
              let document = row["data"], JSONSerialization.isValidJSONObject(document)
        else { throw CloudError.unexpectedResponse }
        let json = try JSONSerialization.data(withJSONObject: document)
        return RemoteSnapshot(data: try DocumentCoding.decodeRemote(json), revision: revision)
    }

    private struct SaveParams: Encodable {
        let document: AppData
        let expected_revision: Int
        let mutation_id: String
    }

    private struct SaveResponse: Decodable {
        let status: String
        let revision: Int
    }

    func save(_ document: AppData, expectedRevision: Int, mutationId: UUID) async throws -> RemoteSaveResult {
        try await checkIdentity()
        let response = try await client.rpc(
            "save_finance_document",
            params: SaveParams(
                document: document,
                expected_revision: expectedRevision,
                mutation_id: mutationId.uuidString.lowercased()
            )
        ).execute()
        guard let result = try? JSONDecoder().decode(SaveResponse.self, from: response.data) else {
            throw CloudError.unexpectedResponse
        }
        switch result.status {
        case "saved": return .saved(revision: result.revision)
        case "conflict": return .conflict(revision: result.revision)
        default: throw CloudError.unexpectedResponse
        }
    }
}
