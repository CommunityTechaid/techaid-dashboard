import { Component } from '@angular/core';
import { Apollo } from 'apollo-angular';
import { ToastrService } from 'ngx-toastr';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import gql from 'graphql-tag';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';

const QUERY_ENTITY = gql`
query find($kitFilter: KitWhereInput!) {
kits(where: $kitFilter){
    id
    type
    model
    status
    donor {
      id
      name
    }
    coordinates {
      lat
      lng
      address
    }
  }
}
`;

@Component({
  selector: 'map-view',
  styleUrls: ['map-view.scss'],
  templateUrl: './map-view.html'
})
export class MapViewComponent {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private location: Location ) {

  }

  markers: Array<any> = [];
  form: FormGroup = new FormGroup({});
  model = {};

  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'type',
          type: 'multicheckbox',
          className: 'col-md-6',
          defaultValue: ['LAPTOP', 'TABLET', 'SMARTPHONE', 'CHROMEBOOK', 'ALLINONE', 'DESKTOP', 'OTHER', 'COMMSDEVICE'],
          templateOptions: {
            label: 'Type of device',
            type: 'array',
            options: [
              {label: 'Laptop', value: 'LAPTOP' },
              {label: 'Chromebook', value: 'CHROMEBOOK' },
              {label: 'Tablet', value: 'TABLET' },
              {label: 'Smart Phone', value: 'SMARTPHONE' },
              {label: 'All In One (PC)', value: 'ALLINONE' },
              {label: 'Desktop', value: 'DESKTOP' },
              {label: 'Connectivity Device', value: 'COMMSDEVICE' },
              {label: 'Other', value: 'OTHER' }
            ],
          }
        },
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-6',
          templateOptions: {
            label: 'Status of the device',
            items: KIT_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        {
          key: 'age',
          type: 'multicheckbox',
          className: 'col-md-6',
          templateOptions: {
            label: 'Roughly how old is your device?',
            type: 'array',
            options: [
              {label: 'Less than a year', value: 1},
              {label: '1 - 2 years', value: 2},
              {label: '3 - 4 years', value: 4 },
              {label: '5 - 6 years', value: 5},
              {label: 'More than 6 years old', value: 6 },
              {label: 'I don\'t know!', value: 0 }
            ],
            required: false
          }
        },
      ]
    }
  ];

  queryRef = this.apollo
    .watchQuery({
      query: QUERY_ENTITY,
      variables: {}
  });

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  back() {
    this.location.back();
  }

  applyFilter(data) {
    const filter = {
      'kitFilter': {}
    };

    if (data.type && data.type) {
      filter['kitFilter']['type'] = {'_in': data.type };
    }

    if (data.age && data.age.length) {
      filter['kitFilter']['age'] = {'_in': data.age };
    }

    if (data.status && data.status.length) {
      filter['kitFilter']['status'] = {'_in': data.status };
    }

    this.fetchData(filter);
  }

  fetchData(filter) {
    const markers = [];
    this.queryRef.refetch(filter).then(res => {

      const types = {
        'CHROMEBOOK': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-laptop&size=50&hoffset=0&voffset=-1&background=30475E',
        'LAPTOP': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-laptop&size=50&hoffset=0&voffset=-1&background=30475E',
        'DESKTOP': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-tv&size=50&hoffset=0&voffset=-1&background=30475E',
        'TABLET': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-tablet&size=50&hoffset=0&voffset=-1&background=D8345F',
        'SMARTPHONE': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-mobile&size=50&hoffset=0&voffset=-1&background=DE7118',
        'ALLINONE': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-tv&size=50&hoffset=0&voffset=-1&background=9C5517',
        'OTHER': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-network-wired&size=50&hoffset=0&voffset=-1&background=EB4559',
        'COMMSDEVICE': 'https://cdn.mapmarker.io/api/v1/font-awesome/v5/pin?icon=fa-wifi&size=50&hoffset=0&voffset=-1&background=EB4559'
      };

      res.data['kits'].forEach(k => {
        if (k.coordinates && k.coordinates.lat) {
          const coord = {lat: +k.coordinates.lat, lng: +k.coordinates.lng};
          markers.push({
            position: coord,
            title: k.name,
            icon: {
                url: types[k.type],
                scaledSize: new google.maps.Size(40, 40),
            },
            info: `
            <strong><a href="/dashboard/devices/${k.id}">${k.model}</a></strong>
            <p>
              <span class="badge badge-secondary mr-1 mb-1">${k.type}</span>
              <br />
              <span class="badge badge-primary mr-1 mb-1">${KIT_STATUS[k.status]}</span>
            </p>
            <p style="max-width: 100px;">${k.coordinates.address}</p>
          `});
        }
      });

      this.markers = markers;
    });
  }

  ngOnInit() {
    this.fetchData({kitFilter: {}});
  }
}
