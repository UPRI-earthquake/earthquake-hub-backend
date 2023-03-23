#!/bin/bash

echo "########### Loading data to Mongo DB ###########"
mongoimport --jsonArray --db testDb --collection accountdetails --file /tmp/data/accountdetails.json
mongoimport --jsonArray --db testDb --collection accounts --file /tmp/data/accounts.json