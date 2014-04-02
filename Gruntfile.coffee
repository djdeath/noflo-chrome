module.exports = ->
  # Project configuration
  @initConfig
    pkg: @file.readJSON 'package.json'

    # Directory cleaning
    clean:
      'noflo-chrome-components':
        src: ['components']
      'noflo-chrome':
        src: ['build']

    # Install components
    component:
      'noflo-chrome':
        options:
          action: 'install'

    # Compiled all components into one file
    componentbuild:
      'noflo-chrome':
        options:
          name: 'noflo-chrome'
          noRequire: false
          configure: (builder) ->
            # Enable Component plugins
            json = require 'component-json'
            builder.use json()
            # Coffee compilation
            coffee = require 'component-coffee'
            builder.use coffee
        dest: 'build'
        src: './'
        scripts: true
        styles: false

    # Fix broken Component aliases, as mentioned in
    # https://github.com/anthonyshort/component-coffee/issues/3
    combine:
      'noflo-chrome':
        input: 'build/noflo-chrome.js'
        output: 'build/noflo-chrome.js'
        tokens: [
          token: '\\.coffee'
          string: '.js'
        ]

    # Combine custom version of component-require
    concat:
      'noflo-chrome':
        src: ['build/noflo-chrome.js', 'aliases.js', 'http.js', 'server.js']
        dest: 'app/noflo-chrome.js'

    # JavaScript minification (Because it's FAST!!!)
    uglify:
      'noflo-chrome':
        options:
          report: 'min'
        files:
          './build/noflo-chrome.min.js': ['./build/noflo-chrome.js']

  # Grunt plugins used for building
  @loadNpmTasks 'grunt-component'
  @loadNpmTasks 'grunt-component-build'
  @loadNpmTasks 'grunt-combine'
  @loadNpmTasks 'grunt-contrib-concat'
  @loadNpmTasks 'grunt-contrib-uglify'
  @loadNpmTasks 'grunt-contrib-clean'

  # Our local tasks
  @registerTask 'build-components', ['component:noflo-chrome', 'componentbuild:noflo-chrome', 'combine:noflo-chrome', 'uglify:noflo-chrome']
  @registerTask 'build', ['build-components', 'concat:noflo-chrome']

  @registerTask 'nuke', ['clean:noflo-chrome-components', 'clean:noflo-chrome']

  @registerTask 'default', ['build']
