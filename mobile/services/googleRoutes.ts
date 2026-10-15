/* File that handle interface with Google API for route generation/retrieval
 */

import type { Coord } from "../pages/schema/booking.schema";

export interface RouteDetails {
  origin: Coord;
  dest: Coord;
  inters?: Coord[];
  depTime: Date;
};

export interface RoutesReqOptions {
  route: RouteDetails;
  apiKey: string;
  fieldMask?: string; // Comma-separated list of response fields
}

/**
 * Takes the provided route information and formats it into JSON that the Google API can understand
 * 
 * @param {Coord} origin the start location of the route 
 * @param {Coord} dest the ending location of the route
 * @param {Coord[]} inters a list of intermediate locations along the route
 * @param {Date} depTime the departure time from the first location
 * @returns a JSON object in the format required by the Google API
 */
export function formatRequest({
  origin,
  dest,
  inters = [],
  depTime,
}: RouteDetails) {
  return {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lon,
        },
      },
      sideOfRoad: true,
    },
    intermediates: inters.map((inter) => ({
      location: {
        latLng: {
          latitude: inter.lat,
          longitude: inter.lon,
        },
      },
      sideOfRoad: true,
      vehicleStopover: true,
    })),
    destination: {
      location: {
        latLng: {
          latitude: dest.lat,
          longitude: dest.lon,
        },
      },
      sideOfRoad: true,
    },
    routingPreference: "TRAFFIC_AWARE",
    travelMode: "DRIVE",
    departureTime: depTime.toISOString(),
    // options to avoid tolls/tunnels exist through the `RouteModifiers` object
    trafficModel: "PESSIMISTIC", // include a bit of buffer time in estimations
    // optimizeWaypointOrder: true,  <- can be included later if we decide to refactor
  };
}

/**
 * Retrieve the route information for a given start/end and intermediatary waypoint
 * Currently not intended for multiple intermediary waypoint although this may change in the future.
 * 
 * @param {RouteDetails} route the information sent to the API about the route
 * @param {String} apiKey our PRIVATE API key
 * @param {String} fieldMask the values we are requesting from the API
 * @returns a JSON object in the format provided by `fieldMask`
 */
export async function computeRoute({
  route,
  apiKey,
  fieldMask = "routes.duration,routes.distanceMeters,routes.legs,routes.optimizedIntermediateWaypointIndex"
}: RoutesReqOptions) {
  // create request object
  const routeReq = formatRequest(route);

  const routeComp = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(routeReq),
  });

  if (routeComp.ok) {
    // handle error
    const err = await routeComp.text();
    throw new Error(`Failed to compute route (${routeComp.status}):\n${err}`);
  }
  // handle response
  return routeComp.json();
}

/**
 * ComputeRoutesResponse: {
 *  routes: Route[],
 *  fallback_info?: FallbackInfo,
 *  geocoding_results: GeocodingResults,
 * }
 * 
 * Route {
 *  route_labels: RouteLabel[],
 *  legs: RouteLeg[],
 *  distance_meters: int32,
 *  duration: Duration,
 *  static_duration: Duration,  <- duration without traffic considerations
 *  polyline: Polyline,
 *  description: string,
 *  warnings: string[],
 *  viewport: Viewport,
 *  travel_advisory: RouteTravelAdvisory,
 *  optimized_intermediate_waypoint_index: int32[]  <- the optimised positions of each waypoint (i.e. [2, 0, 1] means the provided list [WP0, WP1, WP2] is best ordered [WP2, WP0, WP1])
 *  localized_values: RouteLocalizedValues,
 *  route_token: string,  <- could be handle for the option to "Open in Maps"
 *  plyline_details: PolylineDetails,
 * }
 * 
 * RouteLeg {
 *  distance_meters: int32,  <- distance travelled
 *  duration: Duration,  <- travel time
 *  static_duration: Duration,
 *  polyline: Polyline,
 *  start_location: Location,
 *  end_location: Location,
 *  steps: RouteLegStep[],  <- navigation instructions
 *  travel_advisory: RouteLegTravelAdvisory,
 *  localized_values: RouteLegLocalizedValues,
 * }
 * 
 * Duration: {
 *  seconds: int64,  <- use this one
 *  nanos: int32,
 * }
 * 
 * GeocodingResults: {
 *  origin: GeocodedWaypoint,
 *  destination: GeocodedWaypoint,
 *  intermediates: GeocodedWaypoint[],
 * }
 * 
 * GeocodedWaypoint: {
 *  geocoder_status: Status,  <- check isn't an error code
 *  type: string[],
 *  partial_match: bool,
 *  place_id: string,
 *  intermediate_waypoint_request_index: int32,  <- pickup/dropoff order
 * }
 */
