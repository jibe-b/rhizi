(function() {
var config = {
    // urlArgs: "bust=" + (new Date()).getTime(), // NOTE: useful for debugging
    paths: {
        jquery: 'external/jquery',
        'jquery-ui': 'external/jquery-ui',
        'd3': 'external/d3/d3',
        FileSaver: 'external/FileSaver',
        caret: 'external/caret',
        autocomplete: 'external/autocomplete',
    }
}

if (window.is_node) {
    // Testing path only
    console.log('app: running under node');
    config.baseUrl = '../scripts/';
    window.rhizi_require_config = config;
} else {
    // Main app path
    require.config(config);

    requirejs(['main'], function(main) {
        console.log('starting rhizi logic');
        main.main();
    });
}
}());
