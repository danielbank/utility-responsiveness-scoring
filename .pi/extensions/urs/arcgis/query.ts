/**
 * ArcGIS feature layer query — pull features on demand
 */

export interface ArcGISQueryConfig {
  featureServiceUrl: string;
  apiKey: string;
}

export interface ArcGISQueryParams {
  where?: string;
  outFields?: string;
  returnGeometry?: boolean;
  resultRecordCount?: number;
  resultOffset?: number;
  orderByFields?: string;
}

export interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: unknown;
}

export interface ArcGISQueryResult {
  features: ArcGISFeature[];
  error?: string;
}

/**
 * Query features from an ArcGIS feature layer.
 * Uses the REST query endpoint: {baseUrl}/query
 */
export async function queryFeatures(
  config: ArcGISQueryConfig,
  params: ArcGISQueryParams = {}
): Promise<ArcGISQueryResult> {
  if (!config.featureServiceUrl || !config.apiKey) {
    return { features: [], error: "ArcGIS feature service URL and API key required" };
  }

  const baseUrl = config.featureServiceUrl.replace(/\/?$/, "");
  const url = new URL(`${baseUrl}/query`);

  url.searchParams.set("f", "json");
  url.searchParams.set("token", config.apiKey);
  url.searchParams.set("where", params.where ?? "1=1");
  url.searchParams.set("outFields", params.outFields ?? "*");
  url.searchParams.set("returnGeometry", String(params.returnGeometry ?? false));

  if (params.resultRecordCount != null) {
    url.searchParams.set("resultRecordCount", String(params.resultRecordCount));
  }
  if (params.resultOffset != null) {
    url.searchParams.set("resultOffset", String(params.resultOffset));
  }
  if (params.orderByFields) {
    url.searchParams.set("orderByFields", params.orderByFields);
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { features: [], error: `Query failed: ${res.status} ${await res.text()}` };
    }

    const data = (await res.json()) as {
      features?: ArcGISFeature[];
      error?: { message: string };
    };

    if (data.error) {
      return { features: [], error: data.error.message };
    }

    return { features: data.features ?? [] };
  } catch (e) {
    return {
      features: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
