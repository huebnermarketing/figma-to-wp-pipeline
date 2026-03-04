<?php
/**
 * Plugin Name:  Figma Pipeline Bridge
 * Description:  Companion plugin for the Figma → WordPress Elementor pipeline.
 *               Registers Elementor meta fields for REST API access and provides
 *               endpoints for global settings and CSS cache flushing.
 * Version:      1.0.0
 * Author:       Claude AI Pipeline
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ─── Register Elementor post meta for REST API ───────────────────────────────

add_action( 'init', function () {
    $elementor_meta = [
        '_elementor_data',
        '_elementor_edit_mode',
        '_elementor_template_type',
        '_elementor_version',
        '_elementor_page_settings',
    ];

    foreach ( $elementor_meta as $key ) {
        register_post_meta( 'page', $key, [
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () {
                return current_user_can( 'edit_pages' );
            },
        ] );
    }
} );

// ─── REST API: Apply Elementor global settings ────────────────────────────────

add_action( 'rest_api_init', function () {
    register_rest_route( 'figma-pipeline/v1', '/elementor-settings', [
        'methods'             => 'POST',
        'callback'            => 'fp_apply_elementor_settings',
        'permission_callback' => function () {
            return current_user_can( 'manage_options' );
        },
        'args' => [
            'settings' => [ 'required' => true, 'type' => 'object' ],
        ],
    ] );

    register_rest_route( 'figma-pipeline/v1', '/flush-css', [
        'methods'             => 'POST',
        'callback'            => 'fp_flush_elementor_css',
        'permission_callback' => function () {
            return current_user_can( 'edit_pages' );
        },
    ] );

    register_rest_route( 'figma-pipeline/v1', '/deploy-page', [
        'methods'             => 'POST',
        'callback'            => 'fp_deploy_page',
        'permission_callback' => function () {
            return current_user_can( 'publish_pages' );
        },
        'args' => [
            'title'          => [ 'required' => true,  'type' => 'string' ],
            'slug'           => [ 'required' => true,  'type' => 'string' ],
            'elementor_data' => [ 'required' => true,  'type' => 'string' ],
        ],
    ] );
} );

// ─── Callback: Apply global Elementor settings ────────────────────────────────

function fp_apply_elementor_settings( WP_REST_Request $request ) {
    $settings = $request->get_param( 'settings' );

    if ( isset( $settings['system_colors'] ) ) {
        update_option( 'elementor_system_colors', $settings['system_colors'] );
    }
    if ( isset( $settings['system_typography'] ) ) {
        update_option( 'elementor_system_typography', $settings['system_typography'] );
    }
    if ( isset( $settings['container_width'] ) ) {
        update_option( 'elementor_container_width', $settings['container_width'] );
    }

    // Trigger Elementor kit settings update if kit exists
    $kit_id = get_option( 'elementor_active_kit' );
    if ( $kit_id ) {
        if ( isset( $settings['system_colors'] ) ) {
            update_post_meta( $kit_id, '_elementor_system_colors', $settings['system_colors'] );
        }
        if ( isset( $settings['system_typography'] ) ) {
            update_post_meta( $kit_id, '_elementor_system_typography', $settings['system_typography'] );
        }
    }

    return rest_ensure_response( [
        'success' => true,
        'message' => 'Elementor global settings updated.',
        'kit_id'  => $kit_id,
    ] );
}

// ─── Callback: Flush Elementor CSS cache ──────────────────────────────────────

function fp_flush_elementor_css( WP_REST_Request $request ) {
    if ( class_exists( '\Elementor\Plugin' ) ) {
        \Elementor\Plugin::$instance->files_manager->clear_cache();
        return rest_ensure_response( [ 'success' => true, 'message' => 'Elementor CSS cache cleared.' ] );
    }
    return rest_ensure_response( [ 'success' => false, 'message' => 'Elementor not active.' ] );
}

// ─── Callback: Deploy a page with Elementor data ─────────────────────────────

function fp_deploy_page( WP_REST_Request $request ) {
    $title          = sanitize_text_field( $request->get_param( 'title' ) );
    $slug           = sanitize_title( $request->get_param( 'slug' ) );
    $elementor_data = $request->get_param( 'elementor_data' );

    // Validate Elementor data is valid JSON
    json_decode( $elementor_data );
    if ( json_last_error() !== JSON_ERROR_NONE ) {
        return new WP_Error( 'invalid_json', 'elementor_data is not valid JSON.', [ 'status' => 400 ] );
    }

    // Find existing page by slug or create new
    $existing = get_posts( [
        'post_type'   => 'page',
        'name'        => $slug,
        'post_status' => 'any',
        'numberposts' => 1,
    ] );

    $page_data = [
        'post_title'   => $title,
        'post_name'    => $slug,
        'post_status'  => 'publish',
        'post_type'    => 'page',
        'post_content' => '',
    ];

    if ( ! empty( $existing ) ) {
        $page_data['ID'] = $existing[0]->ID;
        $page_id = wp_update_post( $page_data, true );
    } else {
        $page_id = wp_insert_post( $page_data, true );
    }

    if ( is_wp_error( $page_id ) ) {
        return $page_id;
    }

    // Set Elementor meta
    update_post_meta( $page_id, '_elementor_edit_mode',    'builder' );
    update_post_meta( $page_id, '_elementor_template_type', 'wp-page' );
    update_post_meta( $page_id, '_elementor_version',      '3.0.0' );
    update_post_meta( $page_id, '_elementor_data',         wp_slash( $elementor_data ) );

    // Clear Elementor CSS cache for this page
    if ( class_exists( '\Elementor\Plugin' ) ) {
        \Elementor\Plugin::$instance->files_manager->clear_cache();
    }

    return rest_ensure_response( [
        'id'    => $page_id,
        'title' => [ 'rendered' => $title ],
        'link'  => get_permalink( $page_id ),
        'slug'  => $slug,
    ] );
}
