// GENERATED from the live Supabase schema (Supabase MCP generate_typescript_types).
// Do not edit by hand. Regenerate after migrations: see docs/DEPLOYMENT.md.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      address_aliases: {
        Row: {
          address_text: string | null
          alias: string
          created_at: string
          created_by: string | null
          id: string
          is_verified: boolean
          location: unknown
          normalized: string | null
          qls_code: string | null
          updated_at: string
        }
        Insert: {
          address_text?: string | null
          alias: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean
          location: unknown
          normalized?: string | null
          qls_code?: string | null
          updated_at?: string
        }
        Update: {
          address_text?: string | null
          alias?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean
          location?: unknown
          normalized?: string | null
          qls_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "address_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          bid_id: string | null
          booking_id: string
          driver_id: string
          id: string
          method: Database["public"]["Enums"]["allocation_strategy"]
          offer_id: string | null
          release_reason: string | null
          released_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          bid_id?: string | null
          booking_id: string
          driver_id: string
          id?: string
          method: Database["public"]["Enums"]["allocation_strategy"]
          offer_id?: string | null
          release_reason?: string | null
          released_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          bid_id?: string | null
          booking_id?: string
          driver_id?: string
          id?: string
          method?: Database["public"]["Enums"]["allocation_strategy"]
          offer_id?: string | null
          release_reason?: string | null
          released_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_bid_fk"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "booking_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "booking_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_bids: {
        Row: {
          amount_minor: number
          booking_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string | null
          expires_at: string
          id: string
          offer_id: string | null
          parent_bid_id: string | null
          party: Database["public"]["Enums"]["bid_party"]
          responded_at: string | null
          status: Database["public"]["Enums"]["bid_status"]
        }
        Insert: {
          amount_minor: number
          booking_id: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id?: string | null
          expires_at: string
          id?: string
          offer_id?: string | null
          parent_bid_id?: string | null
          party: Database["public"]["Enums"]["bid_party"]
          responded_at?: string | null
          status?: Database["public"]["Enums"]["bid_status"]
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string | null
          expires_at?: string
          id?: string
          offer_id?: string | null
          parent_bid_id?: string | null
          party?: Database["public"]["Enums"]["bid_party"]
          responded_at?: string | null
          status?: Database["public"]["Enums"]["bid_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_bids_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_bids_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_bids_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "booking_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_bids_parent_bid_id_fkey"
            columns: ["parent_bid_id"]
            isOneToOne: false
            referencedRelation: "booking_bids"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          booking_id: string
          created_at: string
          event_type: string
          from_status: Database["public"]["Enums"]["booking_status"] | null
          id: number
          metadata: Json
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_role: string
          booking_id: string
          created_at?: string
          event_type?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: never
          metadata?: Json
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          booking_id?: string
          created_at?: string
          event_type?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: never
          metadata?: Json
          to_status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_offers: {
        Row: {
          bidding_enabled: boolean
          booking_id: string
          category_code: string
          currency: Database["public"]["Enums"]["currency_code"]
          dispatch_round: number
          driver_id: string
          dropoff_address: string | null
          expires_at: string
          fare_minor: number
          id: string
          offered_at: string
          pickup: unknown
          pickup_address: string
          pickup_distance_m: number
          rank: number
          responded_at: string | null
          response_reason: string | null
          status: Database["public"]["Enums"]["offer_status"]
          strategy: Database["public"]["Enums"]["allocation_strategy"]
          trip_distance_m: number
          trip_duration_s: number
        }
        Insert: {
          bidding_enabled?: boolean
          booking_id: string
          category_code: string
          currency: Database["public"]["Enums"]["currency_code"]
          dispatch_round: number
          driver_id: string
          dropoff_address?: string | null
          expires_at: string
          fare_minor: number
          id?: string
          offered_at?: string
          pickup: unknown
          pickup_address: string
          pickup_distance_m: number
          rank?: number
          responded_at?: string | null
          response_reason?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          strategy: Database["public"]["Enums"]["allocation_strategy"]
          trip_distance_m: number
          trip_duration_s: number
        }
        Update: {
          bidding_enabled?: boolean
          booking_id?: string
          category_code?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          dispatch_round?: number
          driver_id?: string
          dropoff_address?: string | null
          expires_at?: string
          fare_minor?: number
          id?: string
          offered_at?: string
          pickup?: unknown
          pickup_address?: string
          pickup_distance_m?: number
          rank?: number
          responded_at?: string | null
          response_reason?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          strategy?: Database["public"]["Enums"]["allocation_strategy"]
          trip_distance_m?: number
          trip_duration_s?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_offers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_riders: {
        Row: {
          booking_id: string
          created_at: string
          name: string
          phone: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          name: string
          phone: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          name?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_riders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_start_pins: {
        Row: {
          booking_id: string
          created_at: string
          failed_attempts: number
          pin: string
          verified_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          failed_attempts?: number
          pin: string
          verified_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          failed_attempts?: number
          pin?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_start_pins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_stops: {
        Row: {
          address: string
          arrived_at: string | null
          booking_id: string
          departed_at: string | null
          id: string
          kind: Database["public"]["Enums"]["stop_kind"]
          location: unknown
          qls_ref: string | null
          seq: number
        }
        Insert: {
          address: string
          arrived_at?: string | null
          booking_id: string
          departed_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["stop_kind"]
          location: unknown
          qls_ref?: string | null
          seq: number
        }
        Update: {
          address?: string
          arrived_at?: string | null
          booking_id?: string
          departed_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["stop_kind"]
          location?: unknown
          qls_ref?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_stops_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          agreed_fare_minor?: number | null
          allocation_strategy?: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at?: string | null
          assigned_at?: string | null
          bidding_enabled?: boolean
          cancel_reason?: string | null
          cancellation_fee_minor?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string | null
          category_id: string
          channel?: Database["public"]["Enums"]["booking_channel"]
          code?: string
          completed_at?: string | null
          confirmed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          dispatch_round?: number
          driver_id?: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref?: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id?: string | null
          fare_rule_id: string
          final_fare_minor?: number | null
          id?: string
          idempotency_key: string
          outstanding_fee_minor?: number
          passenger_id: string
          passenger_note?: string | null
          passenger_offer_minor?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref?: string | null
          reserved_driver_id?: string | null
          reserved_until?: string | null
          route_polyline?: string | null
          scheduled_for?: string | null
          search_expires_at?: string | null
          share_token?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          surge_multiplier?: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          agreed_fare_minor?: number | null
          allocation_strategy?: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at?: string | null
          assigned_at?: string | null
          bidding_enabled?: boolean
          cancel_reason?: string | null
          cancellation_fee_minor?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string | null
          category_id?: string
          channel?: Database["public"]["Enums"]["booking_channel"]
          code?: string
          completed_at?: string | null
          confirmed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          dispatch_round?: number
          driver_id?: string | null
          dropoff?: unknown
          dropoff_address?: string
          dropoff_qls_ref?: string | null
          estimated_distance_m?: number
          estimated_duration_s?: number
          estimated_fare_minor?: number
          fare_estimate_id?: string | null
          fare_rule_id?: string
          final_fare_minor?: number | null
          id?: string
          idempotency_key?: string
          outstanding_fee_minor?: number
          passenger_id?: string
          passenger_note?: string | null
          passenger_offer_minor?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup?: unknown
          pickup_address?: string
          pickup_qls_ref?: string | null
          reserved_driver_id?: string | null
          reserved_until?: string | null
          route_polyline?: string | null
          scheduled_for?: string | null
          search_expires_at?: string | null
          share_token?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          surge_multiplier?: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_fare_estimate_id_fkey"
            columns: ["fare_estimate_id"]
            isOneToOne: false
            referencedRelation: "fare_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_fare_rule_id_fkey"
            columns: ["fare_rule_id"]
            isOneToOne: false
            referencedRelation: "fare_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_reserved_driver_id_fkey"
            columns: ["reserved_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_reconciliation: {
        Row: {
          booking_id: string | null
          collected_minor: number | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          expected_minor: number
          id: string
          note: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          settlement_id: string | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          updated_at: string
          variance_minor: number | null
        }
        Insert: {
          booking_id?: string | null
          collected_minor?: number | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          expected_minor: number
          id?: string
          note?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
          variance_minor?: number | null
        }
        Update: {
          booking_id?: string | null
          collected_minor?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string
          expected_minor?: number
          id?: string
          note?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
          variance_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_reconciliation_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliation_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliation_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliation_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          booking_id: string
          closed_at: string | null
          created_at: string
          driver_id: string
          id: string
          passenger_id: string
        }
        Insert: {
          booking_id: string
          closed_at?: string | null
          created_at?: string
          driver_id: string
          id?: string
          passenger_id: string
        }
        Update: {
          booking_id?: string
          closed_at?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          passenger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      complaints: {
        Row: {
          against_user_id: string | null
          assigned_to: string | null
          booking_id: string | null
          category: string
          complainant_id: string
          created_at: string
          description: string
          id: string
          resolution: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        Insert: {
          against_user_id?: string | null
          assigned_to?: string | null
          booking_id?: string | null
          category: string
          complainant_id: string
          created_at?: string
          description: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Update: {
          against_user_id?: string | null
          assigned_to?: string | null
          booking_id?: string | null
          category?: string
          complainant_id?: string
          created_at?: string
          description?: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_against_user_id_fkey"
            columns: ["against_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_complainant_id_fkey"
            columns: ["complainant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      configuration_settings: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "configuration_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          booking_id: string
          coupon_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          id: string
          user_id: string
        }
        Insert: {
          booking_id: string
          coupon_id: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          id?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          coupon_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_booking_fk"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          assigned_user_id: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          promotion_id: string
          redeemed_count: number
        }
        Insert: {
          assigned_user_id?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          promotion_id: string
          redeemed_count?: number
        }
        Update: {
          assigned_user_id?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          promotion_id?: string
          redeemed_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_documents: {
        Row: {
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          document_number: string | null
          driver_id: string
          expires_at: string | null
          id: string
          mime_type: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          storage_path: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          doc_type: Database["public"]["Enums"]["document_type"]
          document_number?: string | null
          driver_id: string
          expires_at?: string | null
          id?: string
          mime_type?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          storage_path: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          document_number?: string | null
          driver_id?: string
          expires_at?: string | null
          id?: string
          mime_type?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          storage_path?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_earnings: {
        Row: {
          booking_id: string
          commission_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor: number
          id: string
          net_minor: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          settlement_id: string | null
        }
        Insert: {
          booking_id: string
          commission_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor: number
          id?: string
          net_minor: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          settlement_id?: string | null
        }
        Update: {
          booking_id?: string
          commission_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string
          gross_minor?: number
          id?: string
          net_minor?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_earnings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          accuracy_m: number | null
          driver_id: string
          heading_deg: number | null
          location: unknown
          received_at: string
          recorded_at: string
          source: string
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          driver_id: string
          heading_deg?: number | null
          location: unknown
          received_at?: string
          recorded_at: string
          source?: string
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          driver_id?: string
          heading_deg?: number | null
          location?: unknown
          received_at?: string
          recorded_at?: string
          source?: string
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          adjustments_minor: number
          cash_collected_minor: number
          commission_minor: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor: number
          id: string
          net_payable_minor: number
          paid_at: string | null
          payout_reference: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        Insert: {
          adjustments_minor?: number
          cash_collected_minor?: number
          commission_minor?: number
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor?: number
          id?: string
          net_payable_minor?: number
          paid_at?: string | null
          payout_reference?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Update: {
          adjustments_minor?: number
          cash_collected_minor?: number
          commission_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string
          gross_minor?: number
          id?: string
          net_payable_minor?: number
          paid_at?: string | null
          payout_reference?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_wallet_entries: {
        Row: {
          amount_minor: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          id: string
          kind: string
          method: string | null
          note: string | null
          reference: string
          settlement_id: string | null
        }
        Insert: {
          amount_minor: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          id?: string
          kind: string
          method?: string | null
          note?: string | null
          reference: string
          settlement_id?: string | null
        }
        Update: {
          amount_minor?: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string
          id?: string
          kind?: string
          method?: string | null
          note?: string | null
          reference?: string
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_wallet_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_wallet_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_wallet_entries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_wallet_entries_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          acceptance_accepts: number
          acceptance_offers: number
          address_text: string | null
          completed_trips: number
          created_at: string
          current_vehicle_id: string | null
          date_of_birth: string | null
          fleet_id: string | null
          id: string
          is_online: boolean
          licence_expiry: string | null
          licence_number: string
          rating_avg: number | null
          rating_count: number
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["driver_status"]
          suspended_reason: string | null
          updated_at: string
          went_online_at: string | null
        }
        Insert: {
          acceptance_accepts?: number
          acceptance_offers?: number
          address_text?: string | null
          completed_trips?: number
          created_at?: string
          current_vehicle_id?: string | null
          date_of_birth?: string | null
          fleet_id?: string | null
          id: string
          is_online?: boolean
          licence_expiry?: string | null
          licence_number: string
          rating_avg?: number | null
          rating_count?: number
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          suspended_reason?: string | null
          updated_at?: string
          went_online_at?: string | null
        }
        Update: {
          acceptance_accepts?: number
          acceptance_offers?: number
          address_text?: string | null
          completed_trips?: number
          created_at?: string
          current_vehicle_id?: string | null
          date_of_birth?: string | null
          fleet_id?: string | null
          id?: string
          is_online?: boolean
          licence_expiry?: string | null
          licence_number?: string
          rating_avg?: number | null
          rating_count?: number
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          suspended_reason?: string | null
          updated_at?: string
          went_online_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_current_vehicle_fk"
            columns: ["current_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string
          relationship: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone: string
          relationship?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          relationship?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fare_breakdowns: {
        Row: {
          base_minor: number
          booking_fee_minor: number
          booking_id: string | null
          cancellation_minor: number
          commission_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number | null
          distance_minor: number
          driver_net_minor: number
          duration_s: number | null
          fare_estimate_id: string | null
          id: string
          kind: string
          minimum_adjustment_minor: number
          rounding_minor: number
          stops_minor: number
          time_minor: number
          total_minor: number
          waiting_minor: number
          waiting_s: number | null
        }
        Insert: {
          base_minor?: number
          booking_fee_minor?: number
          booking_id?: string | null
          cancellation_minor?: number
          commission_minor?: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          distance_m?: number | null
          distance_minor?: number
          driver_net_minor?: number
          duration_s?: number | null
          fare_estimate_id?: string | null
          id?: string
          kind: string
          minimum_adjustment_minor?: number
          rounding_minor?: number
          stops_minor?: number
          time_minor?: number
          total_minor: number
          waiting_minor?: number
          waiting_s?: number | null
        }
        Update: {
          base_minor?: number
          booking_fee_minor?: number
          booking_id?: string | null
          cancellation_minor?: number
          commission_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          distance_m?: number | null
          distance_minor?: number
          driver_net_minor?: number
          duration_s?: number | null
          fare_estimate_id?: string | null
          id?: string
          kind?: string
          minimum_adjustment_minor?: number
          rounding_minor?: number
          stops_minor?: number
          time_minor?: number
          total_minor?: number
          waiting_minor?: number
          waiting_s?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fare_breakdowns_booking_fk"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_breakdowns_fare_estimate_id_fkey"
            columns: ["fare_estimate_id"]
            isOneToOne: false
            referencedRelation: "fare_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      fare_estimates: {
        Row: {
          breakdown: Json
          category_id: string
          coupon_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          route_polyline: string | null
          route_source: string
          route_steps: Json | null
          stops: Json
          subtotal_minor: number
          surge_multiplier: number
          total_minor: number
        }
        Insert: {
          breakdown: Json
          category_id: string
          coupon_id?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref?: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id?: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref?: string | null
          route_polyline?: string | null
          route_source: string
          route_steps?: Json | null
          stops?: Json
          subtotal_minor: number
          surge_multiplier?: number
          total_minor: number
        }
        Update: {
          breakdown?: Json
          category_id?: string
          coupon_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          discount_minor?: number
          distance_m?: number
          dropoff?: unknown
          dropoff_address?: string
          dropoff_qls_ref?: string | null
          duration_s?: number
          expires_at?: string
          fare_rule_id?: string
          id?: string
          passenger_id?: string
          pickup?: unknown
          pickup_address?: string
          pickup_qls_ref?: string | null
          route_polyline?: string | null
          route_source?: string
          route_steps?: Json | null
          stops?: Json
          subtotal_minor?: number
          surge_multiplier?: number
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "fare_estimates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_estimates_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_estimates_fare_rule_id_fkey"
            columns: ["fare_rule_id"]
            isOneToOne: false
            referencedRelation: "fare_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_estimates_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fare_rules: {
        Row: {
          base_fare_minor: number
          bid_max_pct: number
          bid_min_pct: number
          bidding_enabled: boolean
          booking_fee_minor: number
          cancellation_fee_minor: number
          cancellation_grace_seconds: number
          category_id: string
          commission_bps: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          geofence_id: string | null
          id: string
          is_active: boolean
          minimum_fare_minor: number
          per_km_minor: number
          per_minute_minor: number
          per_stop_minor: number
          rounding_increment_minor: number
          updated_at: string
          valid_from: string
          valid_to: string | null
          waiting_free_minutes: number
          waiting_per_minute_minor: number
        }
        Insert: {
          base_fare_minor: number
          bid_max_pct?: number
          bid_min_pct?: number
          bidding_enabled?: boolean
          booking_fee_minor?: number
          cancellation_fee_minor?: number
          cancellation_grace_seconds?: number
          category_id: string
          commission_bps: number
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          geofence_id?: string | null
          id?: string
          is_active?: boolean
          minimum_fare_minor: number
          per_km_minor: number
          per_minute_minor: number
          per_stop_minor?: number
          rounding_increment_minor?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          waiting_free_minutes?: number
          waiting_per_minute_minor?: number
        }
        Update: {
          base_fare_minor?: number
          bid_max_pct?: number
          bid_min_pct?: number
          bidding_enabled?: boolean
          booking_fee_minor?: number
          cancellation_fee_minor?: number
          cancellation_grace_seconds?: number
          category_id?: string
          commission_bps?: number
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          geofence_id?: string | null
          id?: string
          is_active?: boolean
          minimum_fare_minor?: number
          per_km_minor?: number
          per_minute_minor?: number
          per_stop_minor?: number
          rounding_increment_minor?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          waiting_free_minutes?: number
          waiting_per_minute_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "fare_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fare_rules_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_drivers: {
        Row: {
          driver_id: string
          fleet_id: string
          joined_at: string
          left_at: string | null
        }
        Insert: {
          driver_id: string
          fleet_id: string
          joined_at?: string
          left_at?: string | null
        }
        Update: {
          driver_id?: string
          fleet_id?: string
          joined_at?: string
          left_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_drivers_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_drivers_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      fleets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          join_code: string
          name: string
          owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          join_code?: string
          name: string
          owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          join_code?: string
          name?: string
          owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          booking_id: string | null
          driver_id: string | null
          event_type: string
          geofence_id: string
          id: number
          location: unknown
          occurred_at: string
        }
        Insert: {
          booking_id?: string | null
          driver_id?: string | null
          event_type: string
          geofence_id: string
          id?: never
          location?: unknown
          occurred_at?: string
        }
        Update: {
          booking_id?: string | null
          driver_id?: string | null
          event_type?: string
          geofence_id?: string
          id?: never
          location?: unknown
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_booking_fk"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
        ]
      }
      geofences: {
        Row: {
          area: unknown
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          area: unknown
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          area?: unknown
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      location_history: {
        Row: {
          accuracy_m: number | null
          booking_id: string | null
          driver_id: string
          id: number
          location: unknown
          received_at: string
          recorded_at: string
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          booking_id?: string | null
          driver_id: string
          id?: never
          location: unknown
          received_at?: string
          recorded_at: string
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          booking_id?: string | null
          driver_id?: string
          id?: never
          location?: unknown
          received_at?: string
          recorded_at?: string
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "location_history_booking_fk"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_history_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passengers: {
        Row: {
          completed_trips: number
          created_at: string
          default_payment_method: Database["public"]["Enums"]["payment_method"]
          id: string
          rating_avg: number | null
          rating_count: number
          referral_code: string
          referred_at: string | null
          referred_by: string | null
          updated_at: string
        }
        Insert: {
          completed_trips?: number
          created_at?: string
          default_payment_method?: Database["public"]["Enums"]["payment_method"]
          id: string
          rating_avg?: number | null
          rating_count?: number
          referral_code: string
          referred_at?: string | null
          referred_by?: string | null
          updated_at?: string
        }
        Update: {
          completed_trips?: number
          created_at?: string
          default_payment_method?: Database["public"]["Enums"]["payment_method"]
          id?: string
          rating_avg?: number | null
          rating_count?: number
          referral_code?: string
          referred_at?: string | null
          referred_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "passengers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passengers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          created_at: string
          http_status: number | null
          id: number
          kind: string
          payload: Json
          payment_id: string
          provider_status: string | null
          signature_valid: boolean | null
        }
        Insert: {
          created_at?: string
          http_status?: number | null
          id?: never
          kind: string
          payload?: Json
          payment_id: string
          provider_status?: string | null
          signature_valid?: boolean | null
        }
        Update: {
          created_at?: string
          http_status?: number | null
          id?: never
          kind?: string
          payload?: Json
          payment_id?: string
          provider_status?: string | null
          signature_valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          initiated_at?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn?: string | null
          provider: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          collected_by_driver_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          initiated_at?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          payer_id?: string
          payer_msisdn?: string | null
          provider?: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_collected_by_driver_id_fkey"
            columns: ["collected_by_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
        }
        Relationships: []
      }
      platform_commissions: {
        Row: {
          amount_minor: number
          booking_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          fare_minor: number
          id: string
          rate_bps: number
        }
        Insert: {
          amount_minor: number
          booking_id: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          fare_minor: number
          id?: string
          rate_bps: number
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          driver_id?: string
          fare_minor?: number
          id?: string
          rate_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_commissions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_commissions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_suspended: boolean
          locale: string
          phone: string | null
          preferred_currency: Database["public"]["Enums"]["currency_code"]
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_suspended?: boolean
          locale?: string
          phone?: string | null
          preferred_currency?: Database["public"]["Enums"]["currency_code"]
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          locale?: string
          phone?: string | null
          preferred_currency?: Database["public"]["Enums"]["currency_code"]
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          description: string | null
          discount_type: string
          discount_value: number
          ends_at: string | null
          id: string
          is_active: boolean
          max_discount_minor: number | null
          min_fare_minor: number
          name: string
          per_user_limit: number
          starts_at: string
          updated_at: string
          usage_limit: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          description?: string | null
          discount_type: string
          discount_value: number
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_discount_minor?: number | null
          min_fare_minor?: number
          name: string
          per_user_limit?: number
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_discount_minor?: number | null
          min_fare_minor?: number
          name?: string
          per_user_limit?: number
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_outbox: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          dispatched_at: string | null
          id: number
          kind: string
          shown_at: string | null
          title: string
          ttl_seconds: number
          urgent: boolean
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          dispatched_at?: string | null
          id?: never
          kind: string
          shown_at?: string | null
          title: string
          ttl_seconds?: number
          urgent?: boolean
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          dispatched_at?: string | null
          id?: never
          kind?: string
          shown_at?: string | null
          title?: string
          ttl_seconds?: number
          urgent?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_secret: string
          created_at: string
          endpoint: string
          failures: number
          id: string
          last_status: number | null
          last_success_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_secret: string
          created_at?: string
          endpoint: string
          failures?: number
          id?: string
          last_status?: number | null
          last_success_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_secret?: string
          created_at?: string
          endpoint?: string
          failures?: number
          id?: string
          last_status?: number | null
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qls_lookup_cache: {
        Row: {
          created_at: string
          expires_at: string
          hit_count: number
          id: string
          kind: string
          label: string | null
          location: unknown
          query_hash: string
          query_text: string
          response: Json
        }
        Insert: {
          created_at?: string
          expires_at: string
          hit_count?: number
          id?: string
          kind: string
          label?: string | null
          location?: unknown
          query_hash: string
          query_text: string
          response: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          hit_count?: number
          id?: string
          kind?: string
          label?: string | null
          location?: unknown
          query_hash?: string
          query_text?: string
          response?: Json
        }
        Relationships: []
      }
      qls_usage: {
        Row: {
          billed: boolean
          created_at: string
          endpoint: string
          error_code: string | null
          http_status: number
          id: number
          latency_ms: number | null
          user_id: string | null
        }
        Insert: {
          billed: boolean
          created_at?: string
          endpoint: string
          error_code?: string | null
          http_status: number
          id?: never
          latency_ms?: number | null
          user_id?: string | null
        }
        Update: {
          billed?: boolean
          created_at?: string
          endpoint?: string
          error_code?: string | null
          http_status?: number
          id?: never
          latency_ms?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qls_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          direction: string
          id: string
          ratee_id: string
          rater_id: string
          score: number
          tags: string[]
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          direction: string
          id?: string
          ratee_id: string
          rater_id: string
          score: number
          tags?: string[]
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          direction?: string
          id?: string
          ratee_id?: string
          rater_id?: string
          score?: number
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "ratings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      realtime_events: {
        Row: {
          created_at: string
          event: string
          id: number
          payload: Json
          topic: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: never
          payload: Json
          topic: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: never
          payload?: Json
          topic?: string
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          booking_id: string | null
          created_at: string
          referred_coupon_id: string | null
          referred_id: string
          referrer_coupon_id: string | null
          referrer_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          referred_coupon_id?: string | null
          referred_id: string
          referrer_coupon_id?: string | null
          referrer_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          referred_coupon_id?: string | null
          referred_id?: string
          referrer_coupon_id?: string | null
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referred_coupon_id_fkey"
            columns: ["referred_coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referrer_coupon_id_fkey"
            columns: ["referrer_coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_minor: number
          approved_by: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          payment_id: string
          provider_reference: string | null
          reason: string
          requested_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          approved_by?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          payment_id: string
          provider_reference?: string | null
          reason: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          approved_by?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          payment_id?: string
          provider_reference?: string | null
          reason?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: Database["public"]["Enums"]["app_role"]
          created_at: string
          description: string | null
          name: string
        }
        Insert: {
          code: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description?: string | null
          name: string
        }
        Update: {
          code?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description?: string | null
          name?: string
        }
        Relationships: []
      }
      safety_incidents: {
        Row: {
          acknowledged_at: string | null
          assigned_to: string | null
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["incident_kind"]
          location: unknown
          reporter_id: string
          reporter_role: string
          resolution: string | null
          resolved_at: string | null
          severity: number
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          assigned_to?: string | null
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["incident_kind"]
          location?: unknown
          reporter_id: string
          reporter_role: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: number
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          assigned_to?: string | null
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["incident_kind"]
          location?: unknown
          reporter_id?: string
          reporter_role?: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: number
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_incidents_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_locations: {
        Row: {
          address_text: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["saved_location_kind"]
          label: string
          last_used_at: string
          location: unknown
          provider_place_id: string | null
          qls_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_text: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["saved_location_kind"]
          label: string
          last_used_at?: string
          location: unknown
          provider_place_id?: string | null
          qls_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          address_text?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["saved_location_kind"]
          label?: string
          last_used_at?: string
          location?: unknown
          provider_place_id?: string | null
          qls_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      surge_windows: {
        Row: {
          created_at: string
          created_by: string | null
          days: number[]
          end_local: string
          geofence_id: string | null
          id: string
          is_active: boolean
          label: string
          multiplier: number
          start_local: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number[]
          end_local: string
          geofence_id?: string | null
          id?: string
          is_active?: boolean
          label: string
          multiplier: number
          start_local: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number[]
          end_local?: string
          geofence_id?: string | null
          id?: string
          is_active?: boolean
          label?: string
          multiplier?: number
          start_local?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surge_windows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surge_windows_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_locations: {
        Row: {
          accuracy_m: number | null
          id: number
          location: unknown
          received_at: string
          recorded_at: string
          speed_mps: number | null
          trip_id: string
        }
        Insert: {
          accuracy_m?: number | null
          id?: never
          location: unknown
          received_at?: string
          recorded_at: string
          speed_mps?: number | null
          trip_id: string
        }
        Update: {
          accuracy_m?: number | null
          id?: never
          location?: unknown
          received_at?: string
          recorded_at?: string
          speed_mps?: number | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_waypoints: {
        Row: {
          id: string
          kind: string
          location: unknown
          occurred_at: string
          stop_id: string | null
          trip_id: string
        }
        Insert: {
          id?: string
          kind: string
          location?: unknown
          occurred_at?: string
          stop_id?: string | null
          trip_id: string
        }
        Update: {
          id?: string
          kind?: string
          location?: unknown
          occurred_at?: string
          stop_id?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_waypoints_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "booking_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_waypoints_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          billed_distance_m: number | null
          booking_id: string
          created_at: string
          distance_source: string | null
          driver_id: string
          duration_s: number | null
          end_location: unknown
          ended_at: string | null
          id: string
          start_location: unknown
          started_at: string
          tracked_distance_m: number | null
          vehicle_id: string | null
          waiting_s: number
        }
        Insert: {
          billed_distance_m?: number | null
          booking_id: string
          created_at?: string
          distance_source?: string | null
          driver_id: string
          duration_s?: number | null
          end_location?: unknown
          ended_at?: string | null
          id?: string
          start_location?: unknown
          started_at?: string
          tracked_distance_m?: number | null
          vehicle_id?: string | null
          waiting_s?: number
        }
        Update: {
          billed_distance_m?: number | null
          booking_id?: string
          created_at?: string
          distance_source?: string | null
          driver_id?: string
          duration_s?: number | null
          end_location?: unknown
          ended_at?: string | null
          id?: string
          start_location?: unknown
          started_at?: string
          tracked_distance_m?: number | null
          vehicle_id?: string | null
          waiting_s?: number
        }
        Relationships: [
          {
            foreignKeyName: "trips_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      vehicle_categories: {
        Row: {
          code: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          seats: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          seats: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          seats?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          category_id: string
          color: string
          created_at: string
          driver_id: string | null
          fleet_id: string | null
          id: string
          is_active: boolean
          make: string
          model: string
          plate_number: string
          registration_number: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          year: number | null
        }
        Insert: {
          category_id: string
          color: string
          created_at?: string
          driver_id?: string | null
          fleet_id?: string | null
          id?: string
          is_active?: boolean
          make: string
          model: string
          plate_number: string
          registration_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          year?: number | null
        }
        Update: {
          category_id?: string
          color?: string
          created_at?: string
          driver_id?: string | null
          fleet_id?: string | null
          id?: string
          is_active?: boolean
          make?: string
          model?: string
          plate_number?: string
          registration_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          active_booking_id: string | null
          context: Json
          created_at: string
          id: string
          last_inbound_at: string | null
          profile_id: string | null
          state: string
          updated_at: string
          wa_id: string
        }
        Insert: {
          active_booking_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          profile_id?: string | null
          state?: string
          updated_at?: string
          wa_id: string
        }
        Update: {
          active_booking_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          profile_id?: string | null
          state?: string
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_active_booking_id_fkey"
            columns: ["active_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: Json
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          msg_type: string
          status: string | null
          wa_message_id: string | null
        }
        Insert: {
          body?: Json
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          msg_type: string
          status?: string | null
          wa_message_id?: string | null
        }
        Update: {
          body?: Json
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          msg_type?: string
          status?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_outbox: {
        Row: {
          attempts: number
          body: string
          booking_id: string | null
          created_at: string
          id: number
          last_error: string | null
          sent_at: string | null
          status: string
          wa_id: string
        }
        Insert: {
          attempts?: number
          body: string
          booking_id?: string | null
          created_at?: string
          id?: never
          last_error?: string | null
          sent_at?: string | null
          status?: string
          wa_id: string
        }
        Update: {
          attempts?: number
          body?: string
          booking_id?: string | null
          created_at?: string
          id?: never
          last_error?: string | null
          sent_at?: string | null
          status?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_outbox_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_surge: {
        Args: {
          p_mult: number
          p_rule: Database["public"]["Tables"]["fare_rules"]["Row"]
        }
        Returns: {
          base_fare_minor: number
          bid_max_pct: number
          bid_min_pct: number
          bidding_enabled: boolean
          booking_fee_minor: number
          cancellation_fee_minor: number
          cancellation_grace_seconds: number
          category_id: string
          commission_bps: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          geofence_id: string | null
          id: string
          is_active: boolean
          minimum_fare_minor: number
          per_km_minor: number
          per_minute_minor: number
          per_stop_minor: number
          rounding_increment_minor: number
          updated_at: string
          valid_from: string
          valid_to: string | null
          waiting_free_minutes: number
          waiting_per_minute_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _assign_driver: {
        Args: {
          p_actor_role: string
          p_agreed_fare_minor: number
          p_bid_id: string
          p_booking_id: string
          p_driver_id: string
          p_method: Database["public"]["Enums"]["allocation_strategy"]
          p_offer_id: string
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _cancel_booking: {
        Args: {
          p_actor_role: string
          p_booking_id: string
          p_charge_fee: boolean
          p_reason: string
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _create_booking: {
        Args: {
          p_actor_role: string
          p_channel: Database["public"]["Enums"]["booking_channel"]
          p_estimate_id: string
          p_idempotency_key: string
          p_note: string
          p_passenger_id: string
          p_passenger_offer_minor: number
          p_payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _insert_fare_estimate: {
        Args: {
          p_category_code: string
          p_coupon_code: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_distance_m: number
          p_dropoff_address: string
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_dropoff_qls_ref: string
          p_duration_s: number
          p_passenger_id: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_pickup_qls_ref: string
          p_route_polyline: string
          p_route_source: string
          p_route_steps: Json
          p_stops: Json
        }
        Returns: {
          breakdown: Json
          category_id: string
          coupon_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          route_polyline: string | null
          route_source: string
          route_steps: Json | null
          stops: Json
          subtotal_minor: number
          surge_multiplier: number
          total_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_estimates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _lock_driver_booking: {
        Args: { p_booking_id: string; p_driver_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _make_offer: {
        Args: {
          p_b: Database["public"]["Tables"]["bookings"]["Row"]
          p_distance_m: number
          p_driver_id: string
          p_rank: number
          p_timeout_s: number
        }
        Returns: {
          bidding_enabled: boolean
          booking_id: string
          category_code: string
          currency: Database["public"]["Enums"]["currency_code"]
          dispatch_round: number
          driver_id: string
          dropoff_address: string | null
          expires_at: string
          fare_minor: number
          id: string
          offered_at: string
          pickup: unknown
          pickup_address: string
          pickup_distance_m: number
          rank: number
          responded_at: string | null
          response_reason: string | null
          status: Database["public"]["Enums"]["offer_status"]
          strategy: Database["public"]["Enums"]["allocation_strategy"]
          trip_distance_m: number
          trip_duration_s: number
        }
        SetofOptions: {
          from: "*"
          to: "booking_offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _new_short_code: { Args: { p_len?: number }; Returns: string }
      _new_start_pin: { Args: never; Returns: string }
      _push_enqueue: {
        Args: {
          p_body: string
          p_data: Json
          p_kind: string
          p_title: string
          p_ttl_seconds: number
          p_urgent: boolean
          p_user_id: string
        }
        Returns: undefined
      }
      _push_kick: { Args: never; Returns: undefined }
      _set_driver_fleet: {
        Args: { p_driver_id: string; p_fleet_id: string }
        Returns: string
      }
      _transition_booking: {
        Args: {
          p_actor_role: string
          p_booking_id: string
          p_metadata?: Json
          p_to: Database["public"]["Enums"]["booking_status"]
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_offer: {
        Args: { p_offer_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_assign_driver: {
        Args: { p_booking_id: string; p_driver_id: string; p_reason?: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_assignable_drivers: {
        Args: { p_booking_id: string }
        Returns: {
          distance_m: number
          driver_id: string
          location_age_s: number
          name: string
          phone: string
          plate: string
          rating: number
        }[]
      }
      admin_cancel_booking: {
        Args: { p_booking_id: string; p_charge_fee?: boolean; p_reason: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_booking_for: {
        Args: {
          p_estimate_id: string
          p_idempotency_key: string
          p_note?: string
          p_passenger_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_scheduled_for?: string
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_fleet: {
        Args: { p_name: string; p_owner_id: string; p_phone?: string }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          join_code: string
          name: string
          owner_id: string
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fleets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_promotion: {
        Args: {
          p_category_code: string
          p_coupon_code: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_discount_type: string
          p_discount_value: number
          p_ends_at: string
          p_max_discount_minor: number
          p_min_fare_minor: number
          p_name: string
          p_per_user_limit: number
          p_starts_at: string
          p_usage_limit: number
        }
        Returns: {
          assigned_user_id: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          promotion_id: string
          redeemed_count: number
        }
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_settlement: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_driver_id: string
        }
        Returns: {
          adjustments_minor: number
          cash_collected_minor: number
          commission_minor: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor: number
          id: string
          net_payable_minor: number
          paid_at: string | null
          payout_reference: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_driver_balances: {
        Args: never
        Returns: {
          balance_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          is_online: boolean
          limit_minor: number
          name: string
          over_limit: boolean
          phone: string
        }[]
      }
      admin_geofences: { Args: never; Returns: Json }
      admin_live_map: { Args: never; Returns: Json }
      admin_log_caller_account: {
        Args: { p_created: boolean; p_passenger_id: string }
        Returns: undefined
      }
      admin_mark_settlement_paid: {
        Args: { p_reference: string; p_settlement_id: string }
        Returns: {
          adjustments_minor: number
          cash_collected_minor: number
          commission_minor: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          gross_minor: number
          id: string
          net_payable_minor: number
          paid_at: string | null
          payout_reference: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_reconcile_cash: {
        Args: {
          p_collected_minor: number
          p_note: string
          p_reconciliation_id: string
        }
        Returns: {
          booking_id: string | null
          collected_minor: number | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          expected_minor: number
          id: string
          note: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          settlement_id: string | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          updated_at: string
          variance_minor: number | null
        }
        SetofOptions: {
          from: "*"
          to: "cash_reconciliation"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_record_driver_topup: {
        Args: {
          p_amount_minor: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_driver_id: string
          p_method: string
          p_note?: string
          p_reference: string
        }
        Returns: {
          amount_minor: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          id: string
          kind: string
          method: string | null
          note: string | null
          reference: string
          settlement_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_wallet_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_document: {
        Args: {
          p_decision: Database["public"]["Enums"]["review_status"]
          p_document_id: string
          p_note?: string
        }
        Returns: {
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          document_number: string | null
          driver_id: string
          expires_at: string | null
          id: string
          mime_type: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          storage_path: string
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_driver: {
        Args: {
          p_decision: Database["public"]["Enums"]["driver_status"]
          p_driver_id: string
          p_note?: string
        }
        Returns: {
          acceptance_accepts: number
          acceptance_offers: number
          address_text: string | null
          completed_trips: number
          created_at: string
          current_vehicle_id: string | null
          date_of_birth: string | null
          fleet_id: string | null
          id: string
          is_online: boolean
          licence_expiry: string | null
          licence_number: string
          rating_avg: number | null
          rating_count: number
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["driver_status"]
          suspended_reason: string | null
          updated_at: string
          went_online_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_vehicle: {
        Args: {
          p_decision: Database["public"]["Enums"]["review_status"]
          p_note?: string
          p_vehicle_id: string
        }
        Returns: {
          category_id: string
          color: string
          created_at: string
          driver_id: string | null
          fleet_id: string | null
          id: string
          is_active: boolean
          make: string
          model: string
          plate_number: string
          registration_number: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_config: {
        Args: { p_key: string; p_reason?: string; p_value: Json }
        Returns: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        SetofOptions: {
          from: "*"
          to: "configuration_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_driver_fleet: {
        Args: { p_driver_id: string; p_fleet_id: string }
        Returns: undefined
      }
      admin_set_fleet_active: {
        Args: { p_active: boolean; p_fleet_id: string }
        Returns: undefined
      }
      admin_set_promotion_active: {
        Args: { p_active: boolean; p_promotion_id: string }
        Returns: undefined
      }
      admin_set_role: {
        Args: {
          p_grant: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_user_suspension: {
        Args: { p_reason: string; p_suspended: boolean; p_user_id: string }
        Returns: {
          avatar_path: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_suspended: boolean
          locale: string
          phone: string | null
          preferred_currency: Database["public"]["Enums"]["currency_code"]
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_case: {
        Args: {
          p_assign_to?: string
          p_id: string
          p_resolution?: string
          p_status: Database["public"]["Enums"]["case_status"]
          p_table: string
        }
        Returns: undefined
      }
      admin_upsert_alias: {
        Args: {
          p_address: string
          p_alias: string
          p_lat: number
          p_lng: number
          p_qls_code?: string
          p_verified?: boolean
        }
        Returns: string
      }
      admin_upsert_category: {
        Args: {
          p_active: boolean
          p_code: string
          p_description: string
          p_name: string
          p_seats: number
          p_sort: number
        }
        Returns: {
          code: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          seats: number
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "vehicle_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_fare_rule: {
        Args: { p_rule: Json }
        Returns: {
          base_fare_minor: number
          bid_max_pct: number
          bid_min_pct: number
          bidding_enabled: boolean
          booking_fee_minor: number
          cancellation_fee_minor: number
          cancellation_grace_seconds: number
          category_id: string
          commission_bps: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          geofence_id: string | null
          id: string
          is_active: boolean
          minimum_fare_minor: number
          per_km_minor: number
          per_minute_minor: number
          per_stop_minor: number
          rounding_increment_minor: number
          updated_at: string
          valid_from: string
          valid_to: string | null
          waiting_free_minutes: number
          waiting_per_minute_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_geofence: {
        Args: {
          p_active: boolean
          p_code: string
          p_geojson: Json
          p_kind: string
          p_name: string
        }
        Returns: Json
      }
      admin_upsert_surge_window: {
        Args: {
          p_active: boolean
          p_days: number[]
          p_end: string
          p_geofence_code: string
          p_id: string
          p_label: string
          p_multiplier: number
          p_start: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          days: number[]
          end_local: string
          geofence_id: string | null
          id: string
          is_active: boolean
          label: string
          multiplier: number
          start_local: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "surge_windows"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_waive_fee: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_wallet_adjustment: {
        Args: {
          p_amount_minor: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_driver_id: string
          p_reason: string
        }
        Returns: {
          amount_minor: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string
          id: string
          kind: string
          method: string | null
          note: string | null
          reference: string
          settlement_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_wallet_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_referral_code: { Args: { p_code: string }; Returns: Json }
      booking_transition_allowed: {
        Args: {
          p_from: Database["public"]["Enums"]["booking_status"]
          p_to: Database["public"]["Enums"]["booking_status"]
        }
        Returns: boolean
      }
      bootstrap_super_admin: { Args: { p_user_id: string }; Returns: boolean }
      can_read_booking: { Args: { p_booking_id: string }; Returns: boolean }
      compute_fare: {
        Args: {
          p_discount_minor?: number
          p_distance_m: number
          p_duration_s: number
          p_extra_stops?: number
          p_rule: Database["public"]["Tables"]["fare_rules"]["Row"]
          p_waiting_s?: number
        }
        Returns: Json
      }
      config_bool: { Args: { p_key: string }; Returns: boolean }
      config_int: { Args: { p_key: string }; Returns: number }
      config_numeric: { Args: { p_key: string }; Returns: number }
      config_text: { Args: { p_key: string }; Returns: string }
      confirm_booking: {
        Args: { p_booking_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_booking: {
        Args: {
          p_confirm?: boolean
          p_estimate_id: string
          p_idempotency_key: string
          p_note?: string
          p_passenger_offer_minor?: number
          p_payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_fare_estimate: {
        Args: {
          p_category_code: string
          p_coupon_code?: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_dropoff_address: string
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_dropoff_qls_ref?: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_pickup_qls_ref?: string
          p_stops?: Json
        }
        Returns: {
          breakdown: Json
          category_id: string
          coupon_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          route_polyline: string | null
          route_source: string
          route_steps: Json | null
          stops: Json
          subtotal_minor: number
          surge_multiplier: number
          total_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_estimates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_fare_estimate_for: {
        Args: {
          p_category_code: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_dropoff_address: string
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_passenger_id: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
        }
        Returns: {
          breakdown: Json
          category_id: string
          coupon_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          route_polyline: string | null
          route_source: string
          route_steps: Json | null
          stops: Json
          subtotal_minor: number
          surge_multiplier: number
          total_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_estimates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_fare_estimate_routed: {
        Args: {
          p_category_code: string
          p_coupon_code?: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_distance_m: number
          p_dropoff_address: string
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_dropoff_qls_ref: string
          p_duration_s: number
          p_passenger_id: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_pickup_qls_ref: string
          p_route_polyline: string
          p_route_steps: Json
          p_stops: Json
        }
        Returns: {
          breakdown: Json
          category_id: string
          coupon_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          distance_m: number
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          duration_s: number
          expires_at: string
          fare_rule_id: string
          id: string
          passenger_id: string
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          route_polyline: string | null
          route_source: string
          route_steps: Json | null
          stops: Json
          subtotal_minor: number
          surge_multiplier: number
          total_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_estimates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_surge: {
        Args: { p_at: string; p_pickup: unknown }
        Returns: number
      }
      dispatch_booking: { Args: { p_booking_id: string }; Returns: number }
      driver_balance: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_driver_id: string
        }
        Returns: number
      }
      driver_cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_complete_trip: {
        Args: { p_booking_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_confirm_cash_collected: {
        Args: { p_amount_minor: number; p_booking_id: string }
        Returns: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_counter_bid: {
        Args: { p_amount_minor: number; p_offer_id: string }
        Returns: {
          amount_minor: number
          booking_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          driver_id: string | null
          expires_at: string
          id: string
          offer_id: string | null
          parent_bid_id: string | null
          party: Database["public"]["Enums"]["bid_party"]
          responded_at: string | null
          status: Database["public"]["Enums"]["bid_status"]
        }
        SetofOptions: {
          from: "*"
          to: "booking_bids"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_dashboard: { Args: never; Returns: Json }
      driver_debt_limit: {
        Args: { p_currency: Database["public"]["Enums"]["currency_code"] }
        Returns: number
      }
      driver_join_fleet: { Args: { p_code: string }; Returns: Json }
      driver_leave_fleet: { Args: never; Returns: undefined }
      driver_mark_arrived: {
        Args: { p_booking_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_mark_arriving: {
        Args: { p_booking_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_over_debt_limit: {
        Args: { p_driver_id: string }
        Returns: boolean
      }
      driver_record_stop: {
        Args: { p_booking_id: string; p_event: string; p_stop_id: string }
        Returns: undefined
      }
      driver_set_online: {
        Args: { p_online: boolean }
        Returns: {
          acceptance_accepts: number
          acceptance_offers: number
          address_text: string | null
          completed_trips: number
          created_at: string
          current_vehicle_id: string | null
          date_of_birth: string | null
          fleet_id: string | null
          id: string
          is_online: boolean
          licence_expiry: string | null
          licence_number: string
          rating_avg: number | null
          rating_count: number
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["driver_status"]
          suspended_reason: string | null
          updated_at: string
          went_online_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_start_trip: {
        Args: { p_booking_id: string; p_pin?: string }
        Returns: Json
      }
      driver_update_location: {
        Args: {
          p_accuracy_m: number
          p_heading_deg?: number
          p_lat: number
          p_lng: number
          p_recorded_at?: string
          p_speed_mps?: number
        }
        Returns: Json
      }
      driver_upload_track: {
        Args: { p_booking_id: string; p_points: Json }
        Returns: Json
      }
      driver_wallet: { Args: never; Returns: Json }
      evaluate_coupon: {
        Args: {
          p_category_id: string
          p_code: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_gross_minor: number
          p_user_id: string
        }
        Returns: {
          coupon_id: string
          discount_minor: number
          reason: string
        }[]
      }
      file_complaint: {
        Args: {
          p_booking_id: string
          p_category: string
          p_description: string
        }
        Returns: {
          against_user_id: string | null
          assigned_to: string | null
          booking_id: string | null
          category: string
          complainant_id: string
          created_at: string
          description: string
          id: string
          resolution: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "complaints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_eligible_drivers: {
        Args: { p_booking_id: string; p_limit: number; p_radius_m: number }
        Returns: {
          acceptance_rate: number
          distance_m: number
          driver_id: string
          idle_seconds: number
          vehicle_id: string
        }[]
      }
      fleet_overview: { Args: never; Returns: Json }
      fleet_regenerate_code: { Args: { p_fleet_id: string }; Returns: string }
      fleet_remove_driver: { Args: { p_driver_id: string }; Returns: undefined }
      geodesic_route_estimate: {
        Args: { p_points: unknown[] }
        Returns: {
          distance_m: number
          duration_s: number
        }[]
      }
      get_booking_view: { Args: { p_booking_id: string }; Returns: Json }
      get_shared_trip: { Args: { p_share_token: string }; Returns: Json }
      has_any_role: {
        Args: { p_roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_permission: { Args: { p_permission: string }; Returns: boolean }
      has_role: {
        Args: { p_role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_fleet_operator_of_driver: {
        Args: { p_driver_id: string }
        Returns: boolean
      }
      is_staff: { Args: never; Returns: boolean }
      make_point: { Args: { lat: number; lng: number }; Returns: unknown }
      my_outstanding_fees: { Args: never; Returns: Json }
      my_referral: { Args: never; Returns: Json }
      my_saved_locations: {
        Args: never
        Returns: {
          address_text: string
          id: string
          kind: Database["public"]["Enums"]["saved_location_kind"]
          label: string
          last_used_at: string
          lat: number
          lng: number
          qls_code: string
        }[]
      }
      my_scheduled_rides: {
        Args: never
        Returns: {
          category: string
          code: string
          currency: Database["public"]["Enums"]["currency_code"]
          dropoff_address: string
          estimated_fare_minor: number
          id: string
          pickup_address: string
          scheduled_for: string
        }[]
      }
      nearby_driver_count: {
        Args: { p_category_code?: string; p_lat: number; p_lng: number }
        Returns: number
      }
      nearest_place_label: {
        Args: { p_lat: number; p_lng: number }
        Returns: Json
      }
      passenger_accept_bid: {
        Args: { p_bid_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      passenger_cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      passenger_reject_bid: { Args: { p_bid_id: string }; Returns: undefined }
      passenger_switch_to_cash: {
        Args: { p_booking_id: string }
        Returns: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_mark_initiated: {
        Args: {
          p_payer_msisdn: string
          p_payload: Json
          p_payment_id: string
          p_provider: string
          p_provider_reference: string
        }
        Returns: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_record_result: {
        Args: {
          p_failure_reason: string
          p_kind: string
          p_payload: Json
          p_provider: string
          p_provider_reference: string
          p_signature_valid?: boolean
          p_status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: {
          amount_minor: number
          booking_id: string
          collected_by_driver_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          method: Database["public"]["Enums"]["payment_method"]
          payer_id: string
          payer_msisdn: string | null
          provider: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish: {
        Args: {
          p_event: string
          p_payload: Json
          p_persist?: boolean
          p_topic: string
        }
        Returns: undefined
      }
      push_check_key: { Args: { p_key: string }; Returns: boolean }
      push_claim_batch: {
        Args: { p_limit?: number }
        Returns: {
          endpoint: string
          outbox_id: number
          subscription_id: string
          ttl_seconds: number
          urgent: boolean
        }[]
      }
      push_public_key: { Args: never; Returns: string }
      push_report: { Args: { p_results: Json }; Returns: undefined }
      push_retry: { Args: never; Returns: undefined }
      push_set_vapid: {
        Args: { p_private_jwk: Json; p_public_key: string }
        Returns: Json
      }
      push_subscribe: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: string
      }
      push_take_recent: {
        Args: never
        Returns: {
          body: string
          created_at: string
          data: Json
          id: number
          kind: string
          title: string
          urgent: boolean
        }[]
      }
      push_unsubscribe: { Args: { p_endpoint: string }; Returns: undefined }
      push_vapid: { Args: never; Returns: Json }
      raise_sos: {
        Args: {
          p_booking_id: string
          p_lat?: number
          p_lng?: number
          p_note?: string
        }
        Returns: {
          acknowledged_at: string | null
          assigned_to: string | null
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["incident_kind"]
          location: unknown
          reporter_id: string
          reporter_role: string
          resolution: string | null
          resolved_at: string | null
          severity: number
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "safety_incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rate_booking: {
        Args: {
          p_booking_id: string
          p_comment?: string
          p_score: number
          p_tags?: string[]
        }
        Returns: {
          booking_id: string
          comment: string | null
          created_at: string
          direction: string
          id: string
          ratee_id: string
          rater_id: string
          score: number
          tags: string[]
        }
        SetofOptions: {
          from: "*"
          to: "ratings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      realtime_can_read: { Args: { p_topic: string }; Returns: boolean }
      register_driver: {
        Args: {
          p_address_text?: string
          p_date_of_birth?: string
          p_full_name: string
          p_licence_expiry: string
          p_licence_number: string
        }
        Returns: {
          acceptance_accepts: number
          acceptance_offers: number
          address_text: string | null
          completed_trips: number
          created_at: string
          current_vehicle_id: string | null
          date_of_birth: string | null
          fleet_id: string | null
          id: string
          is_online: boolean
          licence_expiry: string | null
          licence_number: string
          rating_avg: number | null
          rating_count: number
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["driver_status"]
          suspended_reason: string | null
          updated_at: string
          went_online_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_vehicle: {
        Args: {
          p_category_code: string
          p_color: string
          p_make: string
          p_model: string
          p_plate_number: string
          p_registration_number?: string
          p_year: number
        }
        Returns: {
          category_id: string
          color: string
          created_at: string
          driver_id: string | null
          fleet_id: string | null
          id: string
          is_active: boolean
          make: string
          model: string
          plate_number: string
          registration_number: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          year: number | null
        }
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_offer: {
        Args: { p_offer_id: string; p_reason?: string }
        Returns: undefined
      }
      release_scheduled_bookings: { Args: never; Returns: number }
      report_incident: {
        Args: {
          p_booking_id: string
          p_description: string
          p_kind: Database["public"]["Enums"]["incident_kind"]
          p_severity?: number
        }
        Returns: {
          acknowledged_at: string | null
          assigned_to: string | null
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["incident_kind"]
          location: unknown
          reporter_id: string
          reporter_role: string
          resolution: string | null
          resolved_at: string | null
          severity: number
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "safety_incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_active_user: { Args: never; Returns: string }
      require_permission: { Args: { p_permission: string }; Returns: undefined }
      resolve_fare_rule: {
        Args: {
          p_category_id: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_pickup: unknown
        }
        Returns: {
          base_fare_minor: number
          bid_max_pct: number
          bid_min_pct: number
          bidding_enabled: boolean
          booking_fee_minor: number
          cancellation_fee_minor: number
          cancellation_grace_seconds: number
          category_id: string
          commission_bps: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          geofence_id: string | null
          id: string
          is_active: boolean
          minimum_fare_minor: number
          per_km_minor: number
          per_minute_minor: number
          per_stop_minor: number
          rounding_increment_minor: number
          updated_at: string
          valid_from: string
          valid_to: string | null
          waiting_free_minutes: number
          waiting_per_minute_minor: number
        }
        SetofOptions: {
          from: "*"
          to: "fare_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      round_minor: {
        Args: { amount: number; increment: number }
        Returns: number
      }
      run_dispatch_maintenance: { Args: never; Returns: Json }
      run_retention: { Args: never; Returns: undefined }
      save_location: {
        Args: {
          p_address: string
          p_kind: Database["public"]["Enums"]["saved_location_kind"]
          p_label: string
          p_lat: number
          p_lng: number
          p_qls_code?: string
        }
        Returns: string
      }
      schedule_booking: {
        Args: { p_at: string; p_booking_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_address_aliases: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          address_text: string
          alias: string
          lat: number
          lng: number
          qls_code: string
        }[]
      }
      set_booking_rider: {
        Args: { p_booking_id: string; p_name: string; p_phone: string }
        Returns: undefined
      }
      submit_driver_document: {
        Args: {
          p_doc_type: Database["public"]["Enums"]["document_type"]
          p_document_number?: string
          p_expires_at?: string
          p_mime_type: string
          p_storage_path: string
          p_vehicle_id?: string
        }
        Returns: {
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          document_number: string | null
          driver_id: string
          expires_at: string | null
          id: string
          mime_type: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          storage_path: string
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      whatsapp_cancel_booking: {
        Args: { p_booking_id: string; p_passenger_id: string }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      whatsapp_create_booking: {
        Args: {
          p_estimate_id: string
          p_idempotency_key: string
          p_passenger_id: string
        }
        Returns: {
          agreed_fare_minor: number | null
          allocation_strategy: Database["public"]["Enums"]["allocation_strategy"]
          arrived_at: string | null
          assigned_at: string | null
          bidding_enabled: boolean
          cancel_reason: string | null
          cancellation_fee_minor: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          category_id: string
          channel: Database["public"]["Enums"]["booking_channel"]
          code: string
          completed_at: string | null
          confirmed_at: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          discount_minor: number
          dispatch_round: number
          driver_id: string | null
          dropoff: unknown
          dropoff_address: string
          dropoff_qls_ref: string | null
          estimated_distance_m: number
          estimated_duration_s: number
          estimated_fare_minor: number
          fare_estimate_id: string | null
          fare_rule_id: string
          final_fare_minor: number | null
          id: string
          idempotency_key: string
          outstanding_fee_minor: number
          passenger_id: string
          passenger_note: string | null
          passenger_offer_minor: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup: unknown
          pickup_address: string
          pickup_qls_ref: string | null
          reserved_driver_id: string | null
          reserved_until: string | null
          route_polyline: string | null
          scheduled_for: string | null
          search_expires_at: string | null
          share_token: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          surge_multiplier: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_type: string
          p_reason?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      allocation_strategy:
        | "nearest"
        | "sequential"
        | "soft"
        | "broadcast"
        | "manual"
      app_role:
        | "passenger"
        | "driver"
        | "fleet_operator"
        | "support_agent"
        | "admin"
        | "super_admin"
      bid_party: "passenger" | "driver"
      bid_status:
        | "open"
        | "countered"
        | "accepted"
        | "rejected"
        | "expired"
        | "withdrawn"
      booking_channel: "web" | "whatsapp" | "admin"
      booking_status:
        | "DRAFT"
        | "FARE_ESTIMATED"
        | "PENDING_CONFIRMATION"
        | "SEARCHING_DRIVER"
        | "DRIVER_OFFERED"
        | "DRIVER_ASSIGNED"
        | "DRIVER_ARRIVING"
        | "DRIVER_ARRIVED"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "CANCELLED"
        | "EXPIRED"
        | "FAILED"
        | "SCHEDULED"
      case_status:
        | "open"
        | "acknowledged"
        | "investigating"
        | "resolved"
        | "closed"
      currency_code: "USD" | "LRD"
      document_type:
        | "driver_licence"
        | "vehicle_registration"
        | "insurance"
        | "national_id"
        | "profile_photo"
        | "vehicle_photo"
        | "other"
      driver_status: "pending" | "approved" | "rejected" | "suspended"
      incident_kind:
        | "sos"
        | "safety"
        | "accident"
        | "harassment"
        | "vehicle"
        | "other"
      message_direction: "inbound" | "outbound"
      offer_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "expired"
        | "cancelled"
      payment_method: "cash" | "orange_money" | "mtn_momo"
      payment_status:
        | "pending"
        | "initiated"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
        | "partially_refunded"
      reconciliation_status: "pending" | "matched" | "variance" | "resolved"
      review_status: "pending" | "approved" | "rejected"
      saved_location_kind: "saved" | "recent"
      settlement_status: "draft" | "pending" | "paid" | "cancelled"
      stop_kind: "pickup" | "stop" | "dropoff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      allocation_strategy: [
        "nearest",
        "sequential",
        "soft",
        "broadcast",
        "manual",
      ],
      app_role: [
        "passenger",
        "driver",
        "fleet_operator",
        "support_agent",
        "admin",
        "super_admin",
      ],
      bid_party: ["passenger", "driver"],
      bid_status: [
        "open",
        "countered",
        "accepted",
        "rejected",
        "expired",
        "withdrawn",
      ],
      booking_channel: ["web", "whatsapp", "admin"],
      booking_status: [
        "DRAFT",
        "FARE_ESTIMATED",
        "PENDING_CONFIRMATION",
        "SEARCHING_DRIVER",
        "DRIVER_OFFERED",
        "DRIVER_ASSIGNED",
        "DRIVER_ARRIVING",
        "DRIVER_ARRIVED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
        "EXPIRED",
        "FAILED",
        "SCHEDULED",
      ],
      case_status: [
        "open",
        "acknowledged",
        "investigating",
        "resolved",
        "closed",
      ],
      currency_code: ["USD", "LRD"],
      document_type: [
        "driver_licence",
        "vehicle_registration",
        "insurance",
        "national_id",
        "profile_photo",
        "vehicle_photo",
        "other",
      ],
      driver_status: ["pending", "approved", "rejected", "suspended"],
      incident_kind: [
        "sos",
        "safety",
        "accident",
        "harassment",
        "vehicle",
        "other",
      ],
      message_direction: ["inbound", "outbound"],
      offer_status: ["pending", "accepted", "rejected", "expired", "cancelled"],
      payment_method: ["cash", "orange_money", "mtn_momo"],
      payment_status: [
        "pending",
        "initiated",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      reconciliation_status: ["pending", "matched", "variance", "resolved"],
      review_status: ["pending", "approved", "rejected"],
      saved_location_kind: ["saved", "recent"],
      settlement_status: ["draft", "pending", "paid", "cancelled"],
      stop_kind: ["pickup", "stop", "dropoff"],
    },
  },
} as const
