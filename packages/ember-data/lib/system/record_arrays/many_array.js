require("ember-data/system/record_arrays/record_array");
require("ember-data/system/record_arrays/many_array_states");

var get = Ember.get, set = Ember.set;

/**
  A ManyArray is a RecordArray that represents the contents of a has-many
  association.

  The ManyArray is instantiated lazily the first time the association is
  requested.

  ### Inverses

  Often, the associations in Ember Data applications will have
  an inverse. For example, imagine the following models are
  defined:

      App.Post = DS.Model.extend({
        comments: DS.hasMany('App.Comment')
      });

      App.Comment = DS.Model.extend({
        post: DS.belongsTo('App.Post')
      });

  If you created a new instance of `App.Post` and added
  a `App.Comment` record to its `comments` has-many
  association, you would expect the comment's `post`
  property to be set to the post that contained
  the has-many.

  We call the record to which an association belongs the
  association's _owner_.
*/
DS.ManyArray = DS.RecordArray.extend({
  init: function() {
    set(this, 'stateManager', DS.ManyArrayStateManager.create({ manyArray: this }));

    this._super.apply(this, arguments);
    this._initted = true;
    this._linksToSync = Ember.OrderedSet.create();
  },

  /**
    @private

    The record to which this association belongs.

    @property {DS.Model}
  */
  owner: null,

  isDirty: Ember.computed(function() {
    return get(this, 'stateManager.currentState.isDirty');
  }).property('stateManager.currentState').cacheable(),

  isLoaded: Ember.computed(function() {
    return get(this, 'stateManager.currentState.isLoaded');
  }).property('stateManager.currentState').cacheable(),

  send: function(event, context) {
    this.get('stateManager').send(event, context);
  },

  fetch: function() {
    var clientIds = get(this, 'content'),
        store = get(this, 'store'),
        type = get(this, 'type');

    store.fetchUnloadedClientIds(type, clientIds);
  },

  // Overrides Ember.Array's replace method to implement
  replaceContent: function(index, removed, added) {
    // Map the array of record objects into an array of  client ids.
    added = added.map(function(record) {
      Ember.assert("You can only add records of " + (get(this, 'type') && get(this, 'type').toString()) + " to this association.", !get(this, 'type') || (get(this, 'type') === record.constructor));
      return record.get('clientId');
    }, this);

    this._super(index, removed, added);
  },

  arrayContentWillChange: function(index, removed, added) {
    if (this._initted) {
      var owner = get(this, 'owner'),
          name = get(this, 'name');

      // This code is the first half of code that continues inside
      // of arrayContentDidChange. It gets or creates a link from
      // the child object, adds the current owner as the old
      // parent if this is the first time the object was removed
      // from a ManyArray, and sets `newParent` to null.
      //
      // Later, if the object is added to another ManyArray,
      // the `arrayContentDidChange` will set `newParent` on
      // the link.
      for (var i=index; i<index+removed; i++) {
        var record = this.objectAt(i);

        var link = DS.OneToManyLink.forChildAndParent(record, owner);
        link.hasManyName = name;

        if (link.oldParent === undefined) { link.oldParent = owner; }
        link.newParent = null;
        this._linksToSync.add(link);
      }
    }

    return this._super.apply(this, arguments);
  },

  arrayContentDidChange: function(index, removed, added) {
    if (this._initted) {
      var owner = get(this, 'owner'),
          name = get(this, 'name');

      // This code is the second half of code that started in
      // `arrayContentWillChange`. It gets or creates a link
      // from the child object, and adds the current owner as
      // the new parent.
      for (var i=index; i<index+added; i++) {
        var record = this.objectAt(i);

        var link = DS.OneToManyLink.forChildAndParent(record, owner);
        link.hasManyName = name;

        // The oldParent will be looked up in `sync` if it
        // was not set by `belongsToWillChange`.
        link.newParent = owner;
        this._linksToSync.add(link);
      }
    }

    // We wait until the array has finished being
    // mutated before syncing the OneToManyLinks created
    // in arrayContentWillChange, so that the array
    // membership test in the sync() logic operates
    // on the final results.
    this._linksToSync.forEach(function(link) { link.sync(); });
    this._linksToSync.clear();

    return this._super.apply(this, arguments);
  },

  /**
    @private
  */
  assignInverse: function(record) {
    var inverseName = DS.inverseNameFor(record, get(this, 'owner.constructor'), 'belongsTo'),
        owner = get(this, 'owner'),
        currentInverse;

    if (inverseName) {
      currentInverse = get(record, inverseName);
      if (currentInverse !== owner) {
        set(record, inverseName, owner);
      }
    }

    return currentInverse;
  },

  /**
    @private
  */
  removeInverse: function(record) {
    var inverseName = DS.inverseNameFor(record, get(this, 'owner.constructor'), 'belongsTo');

    if (inverseName) {
      var currentInverse = get(record, inverseName);
      if (currentInverse === get(this, 'owner')) {
        set(record, inverseName, null);
      }
    }
  },

  // Create a child record within the owner
  createRecord: function(hash, transaction) {
    var owner = get(this, 'owner'),
        store = get(owner, 'store'),
        type = get(this, 'type'),
        record;

    transaction = transaction || get(owner, 'transaction');

    record = store.createRecord.call(store, type, hash, transaction);
    this.pushObject(record);

    return record;
  },

  /**
    METHODS FOR USE BY INVERSE RELATIONSHIPS
    ========================================

    These methods exists so that belongsTo relationships can
    set their inverses without causing an infinite loop.

    This creates two APIs:

    * the normal enumerable API, which is used by clients
      of the `ManyArray` and triggers a change to inverse
      `belongsTo` relationships.
    * `removeFromContent` and `addToContent`, which are
      used by inverse relationships and do not trigger a
      change to `belongsTo` relationships.

    Unlike the normal `addObject` and `removeObject` APIs,
    these APIs manipulate the `content` array without
    triggering side-effects.
  */

  /** @private */
  removeFromContent: function(record) {
    var clientId = get(record, 'clientId');
    get(this, 'content').removeObject(clientId);
  },

  /** @private */
  addToContent: function(record) {
    var clientId = get(record, 'clientId');
    get(this, 'content').addObject(clientId);
  }
});
